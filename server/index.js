/* Production backend: the LLM routes, published as <poc>-api.astrikos.xyz.
   The built frontend (npm run build → build/) is served separately; see DEPLOY.md.
     PORT=4303 node server/index.js
   Env, first match wins: the shell (PORT on the pm2 command), .env.local, .env, .env.production. */
const path = require('path');
const express = require('express');

const root = path.join(__dirname, '..');
['.env.local', '.env', '.env.production'].forEach((f) => {
  try { process.loadEnvFile?.(path.join(root, f)); } catch (e) { /* file is optional */ }
});

const { createLlmRouter } = require('./llm');

const port = Number(process.env.PORT);
if (!port) {
  console.error('PORT is not set. Start with PORT=<bport> node server/index.js');
  process.exit(1);
}

// The frontend is on another origin, so the browser needs CORS to call the API.
// CORS_ORIGIN is a comma-separated list of allowed origins, or *.
const origins = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);

const app = express();
app.use((req, res, next) => {
  const { origin } = req.headers;
  res.vary('Origin');
  if (origin && (origins.includes('*') || origins.includes(origin))) {
    res.set({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    });
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

app.get('/', (req, res) => res.json({ service: 'dbku-api', ok: true }));
app.use('/api/llm', createLlmRouter());
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(port, () => console.log(`DBKU Command Centre API listening on port ${port}`));
