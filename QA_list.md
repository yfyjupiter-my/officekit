# QA List — officekit

QA run: 2026-11-04 · Branch: `main` (commit `4c9912e`)

## Summary

| Check | Result |
|---|---|
| Type-check (`tsc --noEmit`) | ✅ No errors |
| Lint (`next lint`) | ✅ No warnings (`next lint` is deprecated) |
| Production build | ✅ Passes |
| Page routes (8) | ✅ All 200; unknown route 404 |
| Automated tests | ❌ None — no test files, no `test` script |
| Dependency audit (`pnpm audit`) | ❌ 41 vulnerabilities — 3 critical, 25 high, 13 moderate → after QA-02/03: 24 → after QA-11: **1 moderate** (`minimatch`, dev-only, accepted) |

Status legend: `[ ]` open · `[x]` fixed

---

## Critical

### [x] QA-01 — Unbounded request body buffering (memory DoS)
- **Where:** all upload routes — `src/app/api/pdf/{merge,split,compress,edit}/route.ts`, `src/app/api/image/convert/route.ts`; limits in `src/lib/upload.ts`
- **Problem:** `request.formData()` buffers the entire body in memory before `MAX_FILE_SIZE` / `MAX_FILES` are checked. There is no overall request-size cap.
- **Evidence:** a 400 MB upload was correctly rejected (`FILE_TOO_LARGE`), but server RSS peaked at ~1.4 GB first. `docker-compose.yml` sets `mem_limit: 512m`, so one request can OOM-kill the container.
- **Fix:** reject on `Content-Length` > `MAX_FILES × MAX_FILE_SIZE` + overhead before parsing; ideally stream-parse multipart and abort past the limit.
- **Resolution (fix/qa-critical):**
  - `src/lib/upload.ts`: new `readFormDataWithLimit` / `readJsonWithLimit`. They reject a declared `Content-Length` over the cap with **413 `REQUEST_TOO_LARGE`** before reading the body, and count bytes as they stream, so chunked bodies are cut off at the cap too.
  - Body cap = `min(maxFiles × MAX_FILE_SIZE, MAX_TOTAL_UPLOAD_SIZE)` + 1 MiB multipart overhead (≈26 MB for single-file routes, ≈101 MB for merge / image convert). QR JSON body capped at 64 KB.
  - New `MAX_TOTAL_UPLOAD_SIZE` env (default 100 MB, added to `docker-compose.yml`) plus a `TOTAL_TOO_LARGE` check. Zero or negative `MAX_*` env values now fall back to the defaults (fixes QA-12).
  - All 6 POST routes use the limited readers. Malformed multipart now returns 400 `INVALID_FORM_DATA` instead of an empty 500 (covers that part of QA-08).
- **Verified:** 400 MB upload → 413 in 3 ms (Content-Length) / 71 ms (chunked), RSS 242–273 MB against a 274 MB baseline (was ~1.4 GB). 11 × 10 MB merge → 413. A 200 KB QR body → 413. Normal and near-limit uploads still processed.
- **Follow-up:** a valid 4 × 20 MB merge still raised RSS to ~497 MB because pdf-lib processes whole files in memory. With `mem_limit: 512m`, lower `MAX_TOTAL_UPLOAD_SIZE` (e.g. 50 MB) or raise the memory limit.

### [x] QA-02 — Next.js has critical/high CVEs
- **Package:** `next@15.5.18` → patched in `>=15.5.28`
- **Advisories:** Unauthenticated RCE in Image Optimization API (critical, ×2); RCE on Windows-hosted servers (critical); SSRF in Server Actions / rewrites (high); DoS in App Router Server Actions (high); SSG/ISR cache poisoning (moderate).
- **Fix:** upgrade `next` and `eslint-config-next` to latest 15.5.x (≥15.5.28).
- **Resolution:** `next` and `eslint-config-next` pinned to `15.5.29`. `pnpm audit` no longer reports `next`; critical count 3 → 0.

### [x] QA-03 — sharp bundles vulnerable libvips / libheif / librsvg
- **Package:** `sharp@0.34.5` → patched in `>=0.35.5`
- **Advisories:** inherited libvips CVEs (CVE-2026-33327 et al.), libheif (GHSA-g89c-p67h-r497, GHSA-2jg2-4…), librsvg (CVE-2026-96889).
- **Impact:** the image convert endpoint decodes untrusted, unauthenticated uploads with these libraries.
- **Fix:** upgrade `sharp` to ≥0.35.5 and re-verify the Docker standalone copy of `node_modules/sharp` + `@img`.
- **Resolution:** `sharp` → `^0.35.5`. `next` pulls its own `sharp@^0.34` for image optimization, so a `pnpm-workspace.yaml` override forces `sharp: ^0.35.5` everywhere (lockfile has no 0.34.5). sharp 0.35 removed the `failOnError` option, so `convert.ts` now uses the equivalent `failOn: "warning"`. PNG → JPG / WebP conversion re-verified.
- **Not yet verified:** the Docker image build (it copies `node_modules/sharp` + `@img` into the standalone output).

## High

### [x] QA-04 — Image convert accepts unlisted input formats (SVG, HEIF, TIFF, …)
- **Where:** `src/app/api/image/convert/route.ts`, `src/modules/image/lib/convert.ts`
- **Problem:** UI/API advertise PNG/JPG/WebP only, but any format sharp can decode is accepted. Type check passes if `file.type` is empty or any `image/*`.
- **Evidence:** an SVG upload (`image/svg+xml`) converted successfully → reaches librsvg (see QA-03).
- **Fix:** after `metadata()`, allow only `format ∈ {png, jpeg, webp}`; consider explicit `limitInputPixels`.
- **Resolution:** `convert.ts` reads the image header first and rejects any decoded format other than png/jpeg/webp with 400 `UNSUPPORTED_FORMAT` (this checks the real file contents, so renaming a file doesn't get around it). New `MAX_IMAGE_PIXELS` cap (default 40 MP ≈ 160 MB RGBA; sharp's default ≈268 MP could exceed the 512 MB container) → 400 `IMAGE_TOO_LARGE`, also enforced at decode via `limitInputPixels`.
- **Verified:** SVG, GIF, SVG renamed to `.png` → `UNSUPPORTED_FORMAT`; TIFF → `INVALID_TYPE`; 50 MP PNG → `IMAGE_TOO_LARGE`; PNG→WebP, PNG→JPG, JPG→PNG still 200.

### [x] QA-05 — Ghostscript runs with no timeout
- **Where:** `src/modules/pdf/lib/compress.ts` (`runGhostscript`)
- **Problem:** spawned `gs` has no timeout / kill; a crafted PDF can hang a request and hold CPU indefinitely.
- **Fix:** add a timeout (e.g. 60 s) that kills the child and returns a clear error.
- **Resolution:** `runGhostscript` kills `gs` with SIGKILL after `GHOSTSCRIPT_TIMEOUT_MS` (default 60000) → 422 `GHOSTSCRIPT_TIMEOUT`. Buffered stderr capped at 16 KB.
- **Verified:** with `GHOSTSCRIPT_TIMEOUT_MS=1` → 422 in 15 ms, no orphan `gs` processes; normal compress still 200.

### [x] QA-06 — No rate limiting / abuse protection
- **Where:** all `/api/*` routes
- **Problem:** CPU-heavy endpoints (Ghostscript, sharp, pdf-lib) are public and unauthenticated; easy to exhaust `cpus: 1.0`.
- **Fix:** add per-IP rate limiting (middleware or reverse proxy) and a concurrency cap for heavy jobs.
- **Resolution:** new `src/lib/rate-limit.ts`, applied to all 6 POST routes:
  - Per-client fixed window (`RATE_LIMIT_MAX`, default 30 per `RATE_LIMIT_WINDOW_MS` = 60 s) plus a global window (`RATE_LIMIT_GLOBAL_MAX`, default 300) → 429 `RATE_LIMITED` with `Retry-After`.
  - Heavy routes (pdf ×4, image) take a job slot *after* the upload body is read: `MAX_CONCURRENT_JOBS` (default 2) running, `MAX_QUEUED_JOBS` (default 8) waiting, overflow → 503 `SERVER_BUSY`.
- **Verified:** with limit 5, requests 6–7 from one client → 429 `Retry-After: 60` while another client gets 200. With 1 slot / 0 queue, 3 parallel splits → one 200 and two 503.
- **Caveat:** the per-client key is the first `X-Forwarded-For` entry. Tested: Next.js fills that header from the socket address only when the client didn't send one, and passes a client-supplied value through unchanged, so without a reverse proxy that overwrites it, clients can fake it. The global limit and job cap still bound total load. The state is in-memory, per process, so it only works for single-instance deployments.

### [x] QA-07 — Unbounded page count in split / merge / edit
- **Where:** `src/modules/pdf/lib/{split,merge,edit}.ts`
- **Problem:** a small PDF with tens of thousands of pages produces one in-memory PDF per page plus a ZIP — memory/CPU blow-up within the 25 MB upload limit.
- **Fix:** enforce a max page count (env-configurable).
- **Resolution:** `MAX_PDF_PAGES` (default 500, `src/modules/pdf/lib/limits.ts`) enforced in split, edit, and merge (summed across inputs) → 400 `TOO_MANY_PAGES`. Compress is bounded by the Ghostscript timeout instead, because loading every PDF with pdf-lib first could reject files Ghostscript handles fine.
- **Verified:** split/edit 600 pages → 400; merge 300+300 → 400 (`inputIndex: 1`); split 300 and merge 300+2 → 200.

## Medium

### [x] QA-08 — Client errors returned as 500
- Malformed multipart body → empty **500** (`request.formData()` is outside `try` in every upload route). Expected 400.
- PDF Edit with `pages: {"kind":"range"}` and no `range` → **500** `INTERNAL_ERROR` (`range` never type-checked; `.trim()` throws outside the try in `edit.ts`). Expected 400 `INVALID_OPTION`.
- PDF Compress with an invalid PDF → **500** `GHOSTSCRIPT_FAILED`. Expected 400 `INVALID_PDF` (validate with pdf-lib first or map gs failure).
- **Resolution:**
  - Malformed multipart → 400 `INVALID_FORM_DATA` (done with QA-01).
  - `edit.ts` checks that `pages.range` is a string → 400 `INVALID_OPTION` (`options.pages.range`).
  - `compress.ts` checks for the `%PDF-` header in the first 1 KB → 400 `INVALID_PDF`. Ghostscript failures on files that pass that check → 422 "Could not process this PDF"; a missing Ghostscript install stays 500.
- **Verified:** missing or numeric range → 400; non-PDF to compress → 400; malformed multipart → 400. A truncated file that has a `%PDF-` header is repaired by Ghostscript → 200.

### [ ] QA-09 — PDF Edit fails on non-Latin text (partially resolved)
- **Where:** `src/modules/pdf/lib/edit.ts`
- **Problem:** uses `StandardFonts.Helvetica` (WinAnsi only). Text like `你好` → 400 `OVERLAY_FAILED` "Failed to apply text overlay." with no explanation. Multi-line text also mis-measures width.
- **Fix:** embed a Unicode font via `@pdf-lib/fontkit`, or validate and return a clear "unsupported characters" error.
- **Found while fixing:** *any* line break or tab made `widthOfTextAtSize` throw, so text with Enter pressed in the Edit page's multi-line text box always failed with `OVERLAY_FAILED`.
- **Resolution:**
  - Text is split into lines (CRLF/CR/LF, tabs → 4 spaces) and drawn as a block. Lines align left, right or centre according to the position, with line height 1.2 × font size, and the block is clamped to the page.
  - Characters the font can't render → 400 `UNSUPPORTED_CHARACTERS`, naming the characters (e.g. "你 好").
  - Text is limited to 1000 characters and 20 lines.
- **Verified:** multi-line text with a tab at all 5 positions → 200 and checked visually (rendered with Ghostscript). Latin-1, `– “ ” €` → 200. CJK and emoji → clear 400. 20 lines → 200, 21 → 400.
- **Remaining:** non-Latin text still can't be *rendered*. That needs a Unicode font file (e.g. Noto Sans / Noto Sans CJK subset) plus `@pdf-lib/fontkit`; choosing the font and bundling it (several MB) is still to decide.

### [x] QA-10 — Compress can return a larger file
- **Where:** `src/modules/pdf/lib/compress.ts`
- **Evidence:** 598-byte PDF → 3,052 bytes after `screen` preset.
- **Fix:** return the original bytes when output ≥ input (optionally signal via header).
- **Resolution:** `compressPdfBuffer` returns `{ data, compressed, originalSize }` and returns the input when Ghostscript's output isn't smaller. The response adds `X-Compression-Applied`, `X-Original-Size` and `X-Output-Size` headers, and the Compress page toast says "already optimised, original file returned".
- **Verified:** 598-byte PDF → returned byte-identical, `X-Compression-Applied: false` (was 3,052 bytes). Image-heavy 12.1 MB PDF → 820 KB, `true`.

### [x] QA-11 — Dev-toolchain vulnerabilities (build-time only)
- `postcss` <8.5.18 — arbitrary file read / path traversal via source maps (high)
- `brace-expansion`, `minimatch`, `js-yaml`, `nanoid`, `source-map-js` — ReDoS/DoS (high/moderate), via eslint/tailwind tooling
- **Fix:** `pnpm update` / overrides; re-run `pnpm audit`.
- **Resolution:** `pnpm-workspace.yaml` overrides, each staying within its current major version: `postcss ^8.5.23` (also replaces `next`'s pinned 8.4.31), `js-yaml ^4.3.2`, `brace-expansion@1 ^1.1.21`, `brace-expansion@5 ^5.0.12`, `nanoid@3 ^3.3.18`, `source-map-js ^1.2.2`. Type-check, lint and build pass.
- **Audit now:** 1 moderate. `minimatch@3.1.5` (used by eslint) is fixed only in 11.x, and 3.1.5 is the latest 3.x, so it's **accepted**: dev-only, and it only matches ESLint's own config patterns, never user input.

### [x] QA-12 — Env limits not validated (fixed with QA-01)
- **Where:** `src/lib/env.ts`, `src/lib/upload.ts`
- **Problem:** `MAX_FILE_SIZE` / `MAX_FILES` accept 0 or negative values, silently rejecting every upload.
- **Fix:** fall back to defaults when value ≤ 0.

## Low / Hygiene

### [ ] QA-13 — Build output committed to git
- `.next-officekit/` (197 tracked files, ~300 MB on disk incl. webpack cache) is in the repo; `.gitignore` only covers `.next`.
- **Fix:** add `/.next-officekit/` to `.gitignore` and `git rm -r --cached .next-officekit`.

### [ ] QA-14 — Two lockfiles
- `package-lock.json` and `pnpm-lock.yaml` both present; project uses pnpm (`packageManager`, Dockerfile). Remove `package-lock.json`.

### [ ] QA-15 — No automated tests
- Add a `test` script and API/unit tests (merge, split, compress, edit, qrcode, image convert, error paths, limits).

### [ ] QA-16 — README is create-next-app boilerplate
- Document Ghostscript requirement, env vars (`MAX_FILES`, `MAX_FILE_SIZE`, `UPLOAD_DIR`, `GHOSTSCRIPT_PATH`), Docker usage, API endpoints.

### [ ] QA-17 — `next lint` deprecated
- Migrate to ESLint CLI (`npx @next/codemod@canary next-lint-to-eslint-cli .`).

### [ ] QA-18 — Download URL revoked synchronously; duplicated client helpers
- `URL.revokeObjectURL` immediately after `anchor.click()` in every tool page can cancel downloads in some browsers — defer with `setTimeout`.
- `downloadBlob`, `parseAttachmentFilename`, `formatBytes`, and API-error parsing are copy-pasted across 7 pages — extract to `src/lib/`.

---

## Verified working

- PDF merge / split / compress / edit with valid PDFs
- QR text and Wi-Fi payloads (special characters escaped)
- Image PNG → WebP conversion
- File-size limit (25 MB) and file-count limit (10)
- Validation of page ranges, compress preset, quality, QR width, invalid JSON, wrong content-type
- Temp upload directories cleaned up after each request
