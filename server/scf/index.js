// Tencent Cloud SCF default entry file.
// Configure handler as: index.main_handler
exports.main_handler = async (event, context) => {
  const mod = require('./app.js');
  if (typeof mod?.main_handler === 'function') {
    return await mod.main_handler(event, context);
  }
  if (typeof mod?.main_handler !== 'function' && typeof mod?.exports?.main_handler === 'function') {
    return await mod.exports.main_handler(event, context);
  }
  throw new Error('main_handler not found in ./app.js');
};

