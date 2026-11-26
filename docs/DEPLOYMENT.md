# Installation & deployment

## Local development

```bash
npm install
createdb deck && createdb deck_test         # or any PostgreSQL ≥ 14 you control
export DATABASE_URL=postgres://USER@localhost:5432/deck
npm run dev:server                         # http://localhost:8787 (API + /sync)
npm run dev:web                            # http://localhost:5173 (proxies /api and /sync)
```

Without the server, the editor still runs fully on one device (local mode).

Tests: `DECK_TEST_DATABASE_URL=postgres://USER@localhost:5432/deck_test npm test`, then `npm run test:e2e` (installs nothing; run `npx playwright install chromium` once).

## Production (single node)

```bash
npm ci
npx vite build apps/web
NODE_ENV=production \
DATABASE_URL=postgres://deck:…@db/deck \
DECK_PUBLIC_URL=https://deck.example.com \
DECK_STATIC_DIR=$PWD/apps/web/dist \
npx tsx apps/server/src/main.ts
```

Put it behind a TLS-terminating reverse proxy that forwards WebSocket upgrades for `/sync/*`. In production DECK trusts one proxy hop for client IPs, sets `Secure` cookies and HSTS.

## Docker

```bash
cp .env.example .env            # edit DECK_PUBLIC_URL etc.
export POSTGRES_PASSWORD=…      # strong value
docker compose up --build
```

(The Dockerfile and compose file are provided but were not built in the development environment because no Docker daemon was running.)

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://deck@localhost:5439/deck` | PostgreSQL connection |
| `PORT` | `8787` | HTTP/WebSocket port |
| `DECK_PUBLIC_URL` | `http://localhost:5173` | Public origin (CSRF/origin checks, links in email) |
| `DECK_ALLOWED_ORIGINS` | — | Extra allowed origins |
| `DECK_STATIC_DIR` | — | Serve the built web app |
| `DECK_MAIL_WEBHOOK` | — | HTTP endpoint receiving `{to, subject, text}` for password-reset mail |
| `ANTHROPIC_API_KEY` | — | Enables the server AI provider |
| `DECK_AI_MODEL` | `claude-opus-5-5` | Model for the AI provider |
| `DECK_AUTH_RATE`, `DECK_API_RATE` | `30`, `600` | Requests per IP per minute |
| `DECK_MAX_DOC_BYTES` | 200 MB | Largest document the sync server persists |

## Operations
- The schema is created/updated automatically at start-up (idempotent).
- Back up PostgreSQL normally; documents are single rows (`documents.state`), versions in `versions`.
- The audit trail is in `audit_log`.
