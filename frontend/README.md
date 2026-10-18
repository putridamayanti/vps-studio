# vps-studio frontend

Web dashboard for vps-studio, built with Next.js and shadcn/ui.

## Run it

```bash
cp .env.example .env     # set API_URL if the Go server isn't on http://localhost:8081
npm install
npm run dev              # http://localhost:3100
```

Sign in with the server's `API_KEY`. The key is stored in this browser's localStorage and expires
after 6 hours, after which you're asked for it again.

The browser only talks to this app: `/api/*`, `/hooks/*` and `/healthz` are proxied to `API_URL`
(see [src/proxy.ts](src/proxy.ts)), so the Go server needs no CORS setup and the webhook URL shown
for each app works when this app is deployed publicly. `API_URL` is read at runtime, so the same
Docker image works with any backend address.

## Docker image

The `Dockerfile` builds a standalone Next.js server on port 3100. Set `API_URL` to the backend
(default `http://backend:8081`, the service name in [docker-compose.yml](../docker-compose.yml)).
GitHub Actions publishes it as `ghcr.io/<owner>/<repo>-frontend`
([workflow](../.github/workflows/frontend.yml)). See the [main README](../README.md#deploy) to deploy.

## Features

- **Overview**: server and app counts, apps that need attention.
- **Servers**: add (password or SSH key), edit, re-run setup with a live setup log, remove.
- **Apps**: create (GHCR image, registry token, port, domain or host port, `.env`), deploy with an
  optional tag, start/stop/restart, deployment history with live logs, container logs, an
  environment variable editor with `.env` import/download, settings, delete, and the CI webhook.
