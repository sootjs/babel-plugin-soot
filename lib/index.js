'use strict';

var svgAttributes = require('./attrsSVG');
var NULL;
var HtmlElement = 1;
var ComponentUnknown = 8;
var SvgElement = 16;
var InputElement = 32;
var TextareaElement = 64;
var SelectElement = 128;

function isComponent(name) {
    return name.charAt(0).toUpperCase() === name.charAt(0);
}

function isNullOrUndefined(obj) {
    return obj === undefined || obj === null;
}

function _stringLiteralTrimmer(lastNonEmptyLine, lineCount, line, i) {
    var isFirstLine = (i === 0);
    var isLastLine = (i === lineCount - 1);
    var isLastNonEmptyLine = (i === lastNonEmptyLine);
    // replace rendered whitespace tabs with spaces
    var trimmedLine = line.replace(/\t/g, ' ');
    // trim leading whitespace
    if (!isFirstLine) {
        trimmedLine = trimmedLine.replace(/^[ ]+/, '');
    }
    // trim trailing whitespace
    if (!isLastLine) {
        trimmedLine = trimmedLine.replace(/[ ]+$/, '');
    }
    if (trimmedLine.length > 0) {
        if (!isLastNonEmptyLine) {
            trimmedLine += ' ';
        }
        return trimmedLine;
    }
    return '';
}

function handleWhiteSpace(value) {
    var lines = value.split(/\r\n|\n|\r/);
    var lastNonEmptyLine = 0;

    for (var i = lines.length - 1; i > 0; i--) {
        if (lines[i].match(/[^ \t]/)) {
            lastNonEmptyLine = i;
            break;
        }
    }
    var str = lines
        .map(_stringLiteralTrimmer.bind(null, lastNonEmptyLine, lines.length))
        .filter(function (line) {
            return line.length > 0;
        })
        .join('');

    if (str.length > 0) {
        return str;
    }
    return '';
}

function getHoistedNode(lastNode, path) {
    if (path.parentPath === null) {
        var body = path.node.body;
        var index = body.indexOf(lastNode);
        return {
            node: path.node,
            index: index
        };
    } else {
        return getHoistedNode(path.node, path.parentPath);
    }
}

function addCreateVNodeImportStatement(t, toInsert, opts) {
    var node = toInsert.node;
    var index = toInsert.index;

    if (opts.imports) {
        node.body.splice(index, 0, t.importDeclaration([
            t.ImportSpecifier(t.identifier('V'), t.identifier(opts.pragma || 'V'))
        ], t.stringLiteral(typeof opts.imports === 'string' ? opts.imports : 'soot')));
    } else if (!opts.pragma) {
        node.body.splice(index, 0, t.VariableDeclaration('var', [
            t.VariableDeclarator(
                t.Identifier('V'),
                t.memberExpression(t.identifier('soot'), t.identifier('V'))
            )
        ]));
    }
}

function getVNodeType(t, type) {
    var astType = type.type;
    var component = false;
    var flags;

    if (astType === 'JSXIdentifier') {
        if (isComponent(type.name)) {
            component = true;
            flags = ComponentUnknown;
        } else {
            var tag = type.name;

            type = t.StringLiteral(tag);
            switch (tag) {
                case 'svg':
                    flags = SvgElement;
                    break;
                case 'input':
                    flags = InputElement;
                    break;
                case 'textarea':
                    flags = TextareaElement;
                    break;
                case 'select':
                    flags = SelectElement;
                    break;
                case 'media':
                    flags = MediaElement;
                    break;
                default:
                    flags = HtmlElement;
            }
        }
    } else if (astType === 'JSXMemberExpression') {
        component = true;
        flags = ComponentUnknown;
    }
    return {
        type: type,
        isComponent: component,
        flags: flags
    };
}

function getVNodeChildren(t, astChildren, opts) {
    var children = [];

    for (var i = 0; i < astChildren.length; i++) {
        var child = astChildren[i];
        var vNode = createVNode(t, child, opts);

        if (!isNullOrUndefined(vNode)) {
            children.push(vNode);
        }
    }

    return children.length === 1 ? children[0] : t.arrayExpression(children);
}

function getValue(t, value) {
    if (!value) {
        return t.BooleanLiteral(true);
    }

    if (value.type === 'JSXExpressionContainer') {
        return value.expression;
    }

    return value;
}

function getName(t, name) {
    if (name.indexOf('-') !== 0) {
        return t.StringLiteral(name);
    }
    return t.identifier(name);
}

function getVNodeProps(t, astProps, isComponent) {
    var props = [];
    var key = null;
    var ref = null;
    var className = null;

    for (var i = 0; i < astProps.length; i++) {
        var astProp = astProps[i];

        if (astProp.type === 'JSXSpreadAttribute') {
            props.push({
                astName: null,
                astValue: null,
                astSpread: astProp.argument
            });
        } else {
            var propName = astProp.name;

            if (propName.type === 'JSXIdentifier') {
                propName = propName.name;
            } else if (propName.type === 'JSXNamespacedName') {
                propName = propName.namespace.name + ':' + propName.name.name;
            }

            if (!isComponent && (propName === 'className' || propName === 'class')) {
                className = getValue(t, astProp.value);
            } else if (!isComponent && (propName === 'htmlFor')) {
                props.push({
                    astName: getName(t, 'for'),
                    astValue: getValue(t, astProp.value),
                    astSpread: null
                });
            } else if (propName.substr(0, 11) === 'onComponent' && isComponent) {
                if (!ref) {
                    ref = t.ObjectExpression([]);
                }
                ref.properties.push(
                    t.ObjectProperty(getName(t, propName), getValue(t, astProp.value))
                );
            } else if (!isComponent && propName in svgAttributes) {
                // React compatibility for SVG Attributes
                props.push({
                    astName: getName(t, svgAttributes[propName]),
                    astValue: getValue(t, astProp.value),
                    astSpread: null
                });
            } else {
                switch (propName) {
                    case 'ref':
                        ref = getValue(t, astProp.value);
                        break;
                    case 'key':
                        key = getValue(t, astProp.value);
                        break;
                    default:
                        props.push({
                            astName: getName(t, propName),
                            astValue: getValue(t, astProp.value),
                            astSpread: null
                        });
                }
            }
        }
    }
    /* eslint no-return-assign:0 */
    return {
        props: isNullOrUndefined(props) ? NULL : props = t.ObjectExpression(
            props.map(function (prop) {
                return !prop.astSpread
                    ? t.ObjectProperty(prop.astName, prop.astValue)
                    : t.SpreadProperty(prop.astSpread);
            })
        ),
        key: isNullOrUndefined(key) ? NULL : key,
        ref: isNullOrUndefined(ref) ? NULL : ref,
        className: isNullOrUndefined(className) ? NULL : className
    };
}

function isAstNull(ast) {
    if (!ast) {
        return true;
    }
    if (ast.type === 'ArrayExpression' && ast.elements.length === 0) {
        return true;
    }
    return ast.name === 'null';
}

function createVNodeArgs(t, flags, type, className, children, props, key, ref) {
    var args = [];
    var hasClassName = !isAstNull(className);
    var hasChildren = !isAstNull(children);
    var hasProps = props.properties && props.properties.length > 0;
    var hasKey = !isAstNull(key);
    var hasRef = !isAstNull(ref);
    args.push(t.NumericLiteral(flags));
    args.push(type);

    if (hasClassName) {
        args.push(className);
    } else if (hasChildren || hasProps || hasKey || hasRef) {
        args.push(NULL);
    }

    if (hasChildren) {
        args.push(children);
    } else if (hasProps || hasKey || hasRef) {
        args.push(NULL);
    }

    if (hasProps) {
        args.push(props);
    } else if (hasKey || hasRef) {
        args.push(NULL);
    }

    if (hasKey) {
        args.push(key);
    } else if (hasRef) {
        args.push(NULL);
    }

    if (hasRef) {
        args.push(ref);
    }

    return args;
}

function createVNode(t, astNode, opts) {
    var astType = astNode.type;

    switch (astType) {
        case 'JSXElement':
            var openingElement = astNode.openingElement;
            var vType = getVNodeType(t, openingElement.name);
            var vProps = getVNodeProps(t, openingElement.attributes, vType.isComponent);
            var vChildren = getVNodeChildren(t, astNode.children, opts);
            var flags = vType.flags;
            var props = vProps.props;

            if (vType.isComponent && vChildren) {
                var addChildrenToProps = true;

                if (vChildren.type === 'ArrayExpression' && vChildren.elements.length === 0) {
                    addChildrenToProps = false;
                }
                if (addChildrenToProps) {
                    if (props.properties) {
                        props.properties.push(
                            t.ObjectProperty(
                                t.identifier('children'),
                                vChildren
                            )
                        );
                    } else {
                        props = t.ObjectExpression([
                            t.ObjectProperty(
                                t.identifier('children'),
                                vChildren
                            )
                        ]);
                    }
                }
                vChildren = NULL;
            }
            return t.callExpression(
                t.identifier(opts.pragma || 'V'),
                createVNodeArgs(
                    t,
                    flags,
                    vType.type,
                    vProps.className,
                    vChildren,
                    props,
                    vProps.key,
                    vProps.ref,
                )
            );
        case 'JSXText':
            var text = handleWhiteSpace(astNode.value);

            if (text !== '') {
                return t.StringLiteral(text);
            }
            break;
        case 'JSXExpressionContainer':
            var expression = astNode.expression;

            if (expression && expression.type !== 'JSXEmptyExpression') {
                return expression;
            }
            break;
        default:
            // TODO
            break;
    }
}

module.exports = function (options) {
    var t = options.types;
    NULL = t.identifier('null');

    return {
        visitor: {
            JSXElement: {
                enter: function (path, state) {
                    var opts = state.opts;
                    var node = createVNode(t, path.node, opts);

                    path.replaceWith(node);
                    if (!opts.hoistCreateVNode) {
                        opts.hoistCreateVNode = true;
                        addCreateVNodeImportStatement(t, getHoistedNode(path.node, path.parentPath), opts);
                    }
                }
            }
        },
        inherits: require('babel-plugin-syntax-jsx')
    };
};
