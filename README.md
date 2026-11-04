# officekit

Simple, login-free web tools for everyday office work. Files are processed on
the server and temporary uploads are deleted after each request.

| Tool | Page | API |
|---|---|---|
| PDF Merge | `/tools/pdf/merge` | `POST /api/pdf/merge` |
| PDF Split (one PDF per page, zipped) | `/tools/pdf/split` | `POST /api/pdf/split` |
| PDF Compress (Ghostscript) | `/tools/pdf/compress` | `POST /api/pdf/compress` |
| PDF Edit (text overlay) | `/tools/pdf/edit` | `POST /api/pdf/edit` |
| Image Convert (PNG / JPG / WebP) | `/tools/image/convert` | `POST /api/image/convert` |
| QR Code Generator (text, Wi-Fi) | `/tools/qrcode` | `POST /api/qrcode/generate` |

Built with Next.js 15 (App Router), React 19, Tailwind CSS 4, `pdf-lib`,
`sharp`, `qrcode` and Ghostscript.

## Requirements

- Node.js ≥ 20.9 (Docker image uses Node 22)
- pnpm 11 (via Corepack: `corepack enable`)
- [Ghostscript](https://ghostscript.com/) (`gs`) for PDF Compress — the other
  tools work without it. Set `GHOSTSCRIPT_PATH` if `gs` is not on `PATH`.

## Getting started

```bash
corepack enable
pnpm install
pnpm dev            # http://localhost:3000
```

| Script | What it does |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build` | Production build (standalone output in `.next-officekit/standalone`) |
| `pnpm start` | Serve a production build (for local checks; Docker runs `server.js`) |
| `pnpm test` | Unit + API route tests (Vitest); Ghostscript tests skip if `gs` is missing |
| `pnpm lint` | ESLint |
| `pnpm type-check` | TypeScript, no emit |

> If `pnpm build` fails with `next/font` `ETIMEDOUT` on a network with broken
> IPv6, retry with `NODE_OPTIONS=--dns-result-order=ipv4first`.

## Docker

```bash
docker compose up --build    # http://localhost:3000
```

The compose file runs the app read-only, as the `node` user, with all
capabilities dropped, a tmpfs `/tmp`, and limits of 512 MB memory / 1 CPU.

## Configuration

All settings are environment variables; non-positive or invalid numbers fall
back to the default.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `MAX_FILES` | `10` | Max files per upload request |
| `MAX_FILE_SIZE` | `26214400` (25 MB) | Max size per file |
| `MAX_TOTAL_UPLOAD_SIZE` | `104857600` (100 MB) | Max combined size per request; larger bodies get `413` before being read |
| `MAX_PDF_PAGES` | `500` | Max pages per PDF (summed for merge) |
| `MAX_IMAGE_PIXELS` | `40000000` | Max pixels per input image |
| `GHOSTSCRIPT_PATH` | – | Ghostscript binary (or folder on Windows) |
| `GHOSTSCRIPT_TIMEOUT_MS` | `60000` | Kill Ghostscript after this long (`422`) |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window |
| `RATE_LIMIT_MAX` | `30` | Requests per client per window (`429`) |
| `RATE_LIMIT_GLOBAL_MAX` | `300` | Requests across all clients per window (`429`) |
| `MAX_CONCURRENT_JOBS` | `2` | Heavy jobs (PDF / image) running at once |
| `MAX_QUEUED_JOBS` | `8` | Heavy jobs allowed to wait; beyond that `503` |
| `UPLOAD_DIR` | `./.tmp/uploads` | Temp directory for uploads |

**Memory:** `pdf-lib` processes whole files in memory. With the default 512 MB
container limit, a merge close to `MAX_TOTAL_UPLOAD_SIZE` can approach the
limit — lower `MAX_TOTAL_UPLOAD_SIZE` (e.g. 50 MB) or raise `mem_limit`.

**Rate limiting & proxies:** clients are identified by the first
`X-Forwarded-For` entry. Run behind a reverse proxy that **overwrites** that
header with the real client IP; otherwise clients can spoof it (the global
limit and job cap still bound total load). Limits are in-memory, so they apply
per process — use a shared store if you run multiple instances.

## API

All endpoints accept `POST`. Upload endpoints take `multipart/form-data`;
the QR endpoint takes JSON (max 64 KB). Success returns the file
(`Content-Disposition: attachment`); errors return JSON:

```json
{ "ok": false, "error": { "code": "TOO_MANY_PAGES", "message": "…", "field": "…", "inputIndex": 0 } }
```

| Endpoint | Fields | Returns |
|---|---|---|
| `/api/pdf/merge` | `files[]` (2+ PDFs, in order) | `merged.pdf` |
| `/api/pdf/split` | `file` | `split.zip` (`page-001.pdf`, …) |
| `/api/pdf/compress` | `file`, `preset` = `balanced` \| `screen` \| `ebook` \| `printer` \| `prepress` | `compressed.pdf`; headers `X-Compression-Applied`, `X-Original-Size`, `X-Output-Size` (original returned if not smaller) |
| `/api/pdf/edit` | `file`, `options` (JSON: `text`, `fontSize` 4–200, `opacity` 0–1, `position` = `top-left` \| `top-right` \| `bottom-left` \| `bottom-right` \| `center`, `pages` = `{"kind":"all"}` \| `{"kind":"range","range":"1-3,5"}`) | `edited.pdf` |
| `/api/image/convert` | `files[]` (PNG/JPG/WebP), `outputFormat` = `png` \| `jpg` \| `webp`, `quality` 1–100 or `pngCompressionLevel` 0–9 | `converted.zip` |
| `/api/qrcode/generate` | `{"payload": {"type":"text","text":"…"} \| {"type":"wifi","ssid":"…","security":"WPA"\|"WEP"\|"nopass","password":"…","hidden":false}, "options": {"width":512,"margin":2,"errorCorrectionLevel":"M","foregroundColor":"#RRGGBB","backgroundColor":"#RRGGBB"}}` | `qrcode.png` |

Status codes: `400` invalid input · `413` body too large · `422` PDF could not
be processed / timed out · `429` rate limited · `503` server busy · `500`
server error.

Known limitation: PDF Edit uses the built-in Helvetica font, so overlay text
supports Latin characters only; other characters return
`UNSUPPORTED_CHARACTERS`.

## Project structure

```
src/
  app/            pages (tools/*) and API route handlers (api/*)
  components/     shared UI components
  lib/            upload limits & body readers, rate limiting, env, client helpers
  modules/        tool logic: pdf/, image/, qrcode/ (framework-independent)
tests/            Vitest unit and API route tests
```

See [`QA_list.md`](QA_list.md) for the QA findings and their status.
