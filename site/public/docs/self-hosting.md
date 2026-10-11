# Self-hosting

Papertrade Terminal is a static site plus Cloudflare Pages Functions, so it runs on the Cloudflare free tier. You need Node.js 20 or newer, a Cloudflare account, and the `papertrade-sdk` tarball (the SDK is not on npm yet).

## Layout

| Path | Purpose |
| --- | --- |
| `site/public` | Static output: landing page, `app/`, `app.js`, `chunks/`, `docs/`, discovery files, `_headers`, `_routes.json` |
| `site/functions/mcp.ts` | MCP endpoint (`/mcp`) |
| `site/functions/api/papertrade/[[path]].ts` | Same-origin API proxy |
| `site/functions/_lib/` | MCP plumbing (`mcp.ts`) and the nine tools (`tools.ts`) |
| `site/wrangler.toml` | Pages project config |
| `docs/` | Markdown source for the docs site |

## wrangler.toml

```toml
name = "papertrade-terminal"
compatibility_date = "2026-10-01"
pages_build_output_dir = "public"

[vars]
PAPERTRADE_API_URL = "https://exchange.papertrade.xyz"
```

`PAPERTRADE_API_URL` is optional. Change it to point both the proxy and the MCP tools at a different Papertrade API origin.

## Build

```sh
npm install ../papertrade-sdk-0.1.0.tgz viem
npm install
npm run build:site
```

`build:site` runs `node scripts/build-docs.mjs` first (docs HTML, markdown twins, `search-index.json`, `llms.txt`, `llms-full.txt`, `sitemap.xml`), then `node scripts/build-site.mjs` (esbuild bundle with code splitting into `site/public/app.js` and `chunks/`). Use `npm run build:docs` to rebuild only the docs.

## Run locally

```sh
npm run dev:site
```

This builds and then serves `site/public` with the Functions through `wrangler pages dev` on http://localhost:8788. Put overrides such as `PAPERTRADE_API_URL=...` in `site/.dev.vars`.

## Deploy

```sh
npm run build:site
cd site
npx wrangler pages deploy public --project-name <your-project> --branch main
```

Or `npm run deploy:site`, which builds and runs `wrangler pages deploy` from `site/` using the name in `wrangler.toml`. Run wrangler from inside `site/`. The first deploy creates the Pages project. Authenticate with `wrangler login`, or set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## Routing

`site/public/_routes.json` lists the paths that invoke Functions (`/mcp`, `/api/*` and the landing route), so static files and docs are served directly and cost no Function invocations. `_headers` sets the CSP, security headers, caching and CORS for the discovery files.

## After deploying

```sh
curl -s -X POST https://<your-project>.pages.dev/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Then check `/docs/`, `/llms.txt` and `/.well-known/mcp/server-card.json`. If you host under your own domain, update the absolute URLs that carry `https://papertrade-terminal.pages.dev` (the docs build constants, `server.json` and the discovery files) so canonical links and the server card point at your origin.

## Rate limiting note

The MCP limiter (60 requests per minute per IP) lives in isolate memory, so it is best effort per Cloudflare isolate. For a hard global limit add a Cloudflare rate limiting rule on `/mcp` in your zone.

> Unofficial, not affiliated with Papertrade. Papertrade allows up to 1000x leverage and a small move can lose the whole margin. Apache-2.0.
