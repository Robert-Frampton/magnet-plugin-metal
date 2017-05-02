import {assertDefAndNotNull, assertString} from 'metal-assertions';
import {isFunction, isObject, isString} from 'metal';
import metalJsx from 'babel-preset-metal-jsx';
import Component from 'metal-component';
import soy from 'metal-tools-soy';

const defaultLayout = async (req, content, initialState) =>
  `
<html>
<head>
  <meta charset="UTF-8"/>
</head>
<body>
  ${content}
</body>
</html>`;

const buildSoyFiles = (src, dest) =>
  new Promise((resolve, reject) => {
    const handleError = error => reject(error);
    soy({src, dest, handleError}).on('end', () => resolve());
  });

export default {
  babelPresets() {
    return [metalJsx];
  },

  async build(magnet) {
    const config = magnet.getConfig();

    const src = config.magnet.pluginsConfig.metal.soySrc || ['**/*.soy'];
    const dest = config.magnet.pluginsConfig.metal.soyDest || ['.'];

    // Trivially excludes soy compilation when there are no matching soy files
    // in the application directory.
    const directory = magnet.getDirectory();
    const isTriviallyExcluded = magnet.getFiles({directory, src}).length === 0;
    if (!isTriviallyExcluded) {
      await buildSoyFiles(src, dest);
    }
  },

  test(module, filename, magnet) {
    return isObject(module.route) && Component.isComponentCtor(module.default);
  },

  register(module, filename, magnet) {
    let path = module.route.path;
    let method = module.route.method || 'get';
    let type = module.route.type || 'html';
    let fileshort = filename.substring(magnet.getServerDistDirectory().length);

    assertString(
      method,
      `Route configuration method must be a string, ` + `check ${fileshort}.`
    );
    assertDefAndNotNull(
      path,
      `Route configuration path must be specified, ` + `check ${fileshort}.`
    );

    let app = magnet.getServer().getEngine();

    app[method.toLowerCase()](path, async (req, res, next) => {
      try {
        if (!res.headersSent) {
          const getInitialState = module.default.getInitialState;
          const renderLayout = module.default.renderLayout || defaultLayout;
          let data;
          if (isFunction(getInitialState)) {
            data = await getInitialState(req);
          }
          if (isContentTypeJson(req)) {
            res.json(data);
          } else {
            const layout = await renderLayout(
              req,
              renderToString(module.default, data),
              data
            );

            res
              .type(type)
              .send('<!DOCTYPE html>' + renderLayoutToString(layout));
          }
        }
      } catch (error) {
        next(error);
      }
    });
  },
};

/**
 * Render incremental dom based components to string.
 * @param {Class} ctor
 * @param {Object} data
 * @return {string}
 */
function renderToString(ctor, data) {
  try {
    return Component.renderToString(ctor, data);
  } catch (error) {
    throw new Error(
      `Metal.js component type defined in this route cannot be rendered ` +
        `from the server, only Soy or JSX components are supported.`
    );
  }
}

/**
 * Render incremental dom based layouts to string.
 * @param {function|string} fnOrString
 * @return {string}
 */
function renderLayoutToString(fnOrString) {
  if (isString(fnOrString)) {
    return fnOrString;
  }
  try {
    const element = {};
    IncrementalDOM.patch(element, () => fnOrString);
    return element.innerHTML;
  } catch (error) {
    throw new Error(
      `Metal.js layout type defined in this route cannot be rendered ` +
        `from the server, only String or JSX layouts are supported.`
    );
  }
}

/**
 * Check if request content type is application/json.
 * @param {Object} req
 * @return {boolean}
 */
function isContentTypeJson(req) {
  const contentType = req.get('content-type') || '';
  return contentType.toLowerCase().indexOf('application/json') === 0;
}
