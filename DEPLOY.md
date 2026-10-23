# Deploy: DBKU Command Centre (`dbku`) on astrikos.xyz

Follows the astrikos.xyz deployment convention: one frontend port, one backend port, one nginx block each.

| Tier | Process | Port | Public URL | pm2 name | Cloudflare |
| --- | --- | --- | --- | --- | --- |
| Frontend | static `build/` via `serve` | **3303** | `https://dbku.astrikos.xyz:8443` | `dbku_3303` | Orange (proxied) |
| Backend | `server/index.js` (Express, REST) | **4303** | `https://dbku-api.astrikos.xyz:8443` | `dbku_be_4303` | Gray (DNS only) |

Port registry row: `| dbku | 3303 | 4303 | live |`

**Stack notes**

- The frontend is Create React App, so the build goes to `build/` (not `dist/`), and browser env vars use the `REACT_APP_` prefix: `REACT_APP_API_URL` stands in for the convention's `VITE_API_URL`.
- The backend is a single Express process with the routes `GET /` (health), `GET /api/llm/status`, `POST /api/llm/classify-photo` and `POST /api/llm/report`. It reads its port from `PORT` and exits if `PORT` is not set.
- The app has **no websockets**, so there is no `REACT_APP_SOCKET_URL`. The backend nginx block still uses the websocket-upgrade shape, as the convention requires.
- All cross-service URLs are in `.env.production`, which is committed and holds no secrets:
  ```
  REACT_APP_API_URL=https://dbku-api.astrikos.xyz:8443   # baked into the bundle at build time
  CORS_ORIGIN=https://dbku.astrikos.xyz:8443             # read by the backend
  ```

## 1. Prerequisites (once)

- Node **20.12 or later**. The backend loads `.env` with `process.loadEnvFile`, which older versions lack.
- `pm2` and `serve` installed globally: `npm i -g pm2 serve`.
- An Anthropic API key in `.env` at the repo root on the server. The file is git-ignored and is never sent to the browser.
  ```
  ANTHROPIC_API_KEY=sk-ant-...
  ```
  Without a key the app still runs in offline mode: police reports use the built-in template and the scrap photo check is skipped.

## 2. Build and start

```bash
cd <repo-dir>                                       # frontend and backend share this directory

# ── Frontend (static SPA) ─────────────────────────────────────────
npm install && npm run build                        # → build/
pm2 start serve --name "dbku_3303" -- ./build -s -p 3303

# ── Backend (REST API, single port) ───────────────────────────────
PORT=4303 pm2 start server/index.js --name "dbku_be_4303"

pm2 save
```

`npm install` must include devDependencies (Tailwind runs during the build). Do not set `NODE_ENV=production` before running it.

## 3. nginx

`/etc/nginx/conf/astrikos.conf` (frontend):

```nginx
server {
    listen 8443 ssl;
    ssl_certificate     /etc/certs/astrikos.xyz/fullchain.pem;
    ssl_certificate_key /etc/certs/astrikos.xyz/privkey.pem;
    server_name dbku.astrikos.xyz;
    location / {
        add_header 'Access-Control-Allow-Origin' '*' always;
        proxy_pass http://127.0.0.1:3303;
    }
}
```

`/etc/nginx/conf/astriverse.conf` (backend). The `map $http_upgrade $connection_upgrade {…}` block must already be at the top of the file.

```nginx
server {
    listen 8443 ssl;
    ssl_certificate     /etc/certs/astrikos.xyz/fullchain.pem;
    ssl_certificate_key /etc/certs/astrikos.xyz/privkey.pem;
    server_name dbku-api.astrikos.xyz;
    client_max_body_size 25m;
    location / {
        proxy_pass http://127.0.0.1:4303;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
        proxy_buffering off;
    }
}
```

`client_max_body_size 25m` is the one addition to the standard block. The police-report request carries up to three evidence photos as base64, which exceeds nginx's 1 MB default and would fail with `413`. The value matches the backend's own limit in `server/llm.js`.

Apply the changes:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 4. Cloudflare DNS

| Record | Proxy |
| --- | --- |
| `dbku.astrikos.xyz` | **Orange** (proxied) |
| `dbku-api.astrikos.xyz` | **Gray** (DNS only) |

## 5. Verify

```bash
curl -k https://dbku.astrikos.xyz:8443                       # SPA HTML (<title>DBKU Command Centre…)
curl -k https://dbku-api.astrikos.xyz:8443/                  # {"service":"dbku-api","ok":true}
curl -k https://dbku-api.astrikos.xyz:8443/api/llm/status    # {"enabled":true,"model":"claude-opus-5-5"}

# CORS preflight from the frontend origin → 204 with Access-Control-Allow-Origin
curl -k -i -X OPTIONS https://dbku-api.astrikos.xyz:8443/api/llm/report \
  -H "Origin: https://dbku.astrikos.xyz:8443" -H "Access-Control-Request-Method: POST"
```

In the app, the badge on Scrap Registry and Reports reads "LLM offline: template fallback" when the browser cannot reach the API or no key is set. Hover over the badge to see the reason.

## 6. Updating

```bash
cd <repo-dir>
git pull && npm install && npm run build
pm2 restart dbku_3303 dbku_be_4303
```

- `REACT_APP_API_URL` is baked into the bundle at build time, so changing it needs `npm run build`.
- After changing `.env` (the API key) or `CORS_ORIGIN`, run `pm2 restart dbku_be_4303`.
- To change the backend port, run `pm2 delete dbku_be_4303` and start it again with the new `PORT`. `pm2 restart` keeps the old value.
