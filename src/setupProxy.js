/* Create React App loads this file into the dev server (npm start).
   It mounts the server-side LLM routes so the Anthropic key, read from
   .env.local, never reaches the browser bundle. */
const { createLlmRouter } = require('../server/llm');

module.exports = function setupProxy(app) {
  app.use('/api/llm', createLlmRouter());
};
