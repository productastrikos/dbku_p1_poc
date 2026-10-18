/* Production server: serves the built app (npm run build) and the LLM routes.
     npm run build && npm run serve      # http://localhost:8080 */
const path = require('path');
const express = require('express');

const root = path.join(__dirname, '..');
['.env.local', '.env'].forEach((f) => {
  try { process.loadEnvFile?.(path.join(root, f)); } catch (e) { /* file is optional */ }
});

const { createLlmRouter } = require('./llm');

const app = express();
const build = path.join(root, 'build');
app.use('/api/llm', createLlmRouter());
app.use(express.static(build));
app.use((req, res) => res.sendFile(path.join(build, 'index.html')));

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => console.log(`GuardGrid running on http://localhost:${port}`));
