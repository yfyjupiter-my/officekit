import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { POST as convertImages } from "@/app/api/image/convert/route"
import { POST as compressPdf } from "@/app/api/pdf/compress/route"
import { POST as editPdf } from "@/app/api/pdf/edit/route"
import { POST as mergePdf } from "@/app/api/pdf/merge/route"
import { POST as splitPdf } from "@/app/api/pdf/split/route"
import { POST as generateQr } from "@/app/api/qrcode/generate/route"

import {
  errorCode,
  fileOf,
  hasGhostscript,
  makeImage,
  makePdf,
  multipartRequest,
  SVG,
  withEnv,
} from "./helpers"

const URL_BASE = "http://localhost/api"
let uploadDir: string
const savedEnv = { ...process.env }

beforeAll(async () => {
  uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), "officekit-test-"))
  process.env.UPLOAD_DIR = uploadDir
  // Route tests share one in-process limiter; keep it out of the way.
  process.env.RATE_LIMIT_MAX = "100000"
  process.env.RATE_LIMIT_GLOBAL_MAX = "100000"
})

afterAll(async () => {
  process.env = savedEnv
  await fs.rm(uploadDir, { recursive: true, force: true })
})

async function pdfFile(pages: number, name = "doc.pdf"): Promise<File> {
  return fileOf(await makePdf(pages), name, "application/pdf")
}

describe("POST /api/pdf/merge", () => {
  it("returns a merged PDF and cleans up temp uploads", async () => {
    const response = await mergePdf(
      multipartRequest(`${URL_BASE}/pdf/merge`, {
        "files[]": [await pdfFile(1), await pdfFile(2)],
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/pdf")
    expect(await fs.readdir(uploadDir)).toEqual([])
  })

  it("requires at least two files", async () => {
    const response = await mergePdf(
      multipartRequest(`${URL_BASE}/pdf/merge`, { "files[]": [await pdfFile(1)] }),
    )
    expect(response.status).toBe(400)
    expect(await errorCode(response)).toBe("TOO_FEW_FILES")
  })

  it("rejects a body over the size cap with 413 before parsing", async () => {
    await withEnv({ MAX_FILE_SIZE: "1000", MAX_FILES: "2" }, async () => {
      const big = fileOf(new Uint8Array(5000), "big.pdf", "application/pdf")
      const request = multipartRequest(`${URL_BASE}/pdf/merge`, { "files[]": [big, big] })
      // Undici computes Content-Length for FormData bodies only when sent;
      // set it explicitly as a real client would.
      const body = await request.arrayBuffer()
      const sized = new Request(request.url, {
        method: "POST",
        body,
        headers: {
          "content-type": request.headers.get("content-type")!,
          "content-length": String(body.byteLength + 2 * 1024 * 1024),
        },
      })
      const response = await mergePdf(sized)
      expect(response.status).toBe(413)
      expect(await errorCode(response)).toBe("REQUEST_TOO_LARGE")
    })
  })

  it("returns 400 for malformed multipart", async () => {
    const response = await mergePdf(
      new Request(`${URL_BASE}/pdf/merge`, {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=x" },
        body: "garbage",
      }),
    )
    expect(response.status).toBe(400)
    expect(await errorCode(response)).toBe("INVALID_FORM_DATA")
  })
})

describe("POST /api/pdf/split", () => {
  it("returns a zip", async () => {
    const response = await splitPdf(
      multipartRequest(`${URL_BASE}/pdf/split`, { file: await pdfFile(2) }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/zip")
  })

  it("rejects the wrong content type", async () => {
    const response = await splitPdf(
      new Request(`${URL_BASE}/pdf/split`, { method: "POST", body: "a=b" }),
    )
    expect(await errorCode(response)).toBe("INVALID_CONTENT_TYPE")
  })
})

describe("POST /api/pdf/edit", () => {
  const options = (extra: object = {}) =>
    JSON.stringify({
      text: "Draft",
      fontSize: 24,
      opacity: 1,
      position: "center",
      pages: { kind: "all" },
      ...extra,
    })

  it("returns an edited PDF", async () => {
    const response = await editPdf(
      multipartRequest(`${URL_BASE}/pdf/edit`, { file: await pdfFile(1), options: options() }),
    )
    expect(response.status).toBe(200)
  })

  it.each([
    [{ pages: { kind: "range" } }, "INVALID_OPTION"],
    [{ text: "你好" }, "UNSUPPORTED_CHARACTERS"],
  ])("returns 400 for %j", async (extra, code) => {
    const response = await editPdf(
      multipartRequest(`${URL_BASE}/pdf/edit`, {
        file: await pdfFile(1),
        options: options(extra),
      }),
    )
    expect(response.status).toBe(400)
    expect(await errorCode(response)).toBe(code)
  })
})

describe.skipIf(!hasGhostscript())("POST /api/pdf/compress", () => {
  it("returns the original when compression does not help", async () => {
    const response = await compressPdf(
      multipartRequest(`${URL_BASE}/pdf/compress`, { file: await pdfFile(1) }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("x-compression-applied")).toBe("false")
  })

  it("returns 400 for a non-PDF", async () => {
    const response = await compressPdf(
      multipartRequest(`${URL_BASE}/pdf/compress`, {
        file: fileOf(new TextEncoder().encode("nope"), "x.pdf", "application/pdf"),
      }),
    )
    expect(response.status).toBe(400)
    expect(await errorCode(response)).toBe("INVALID_PDF")
  })

  it("rejects an unknown preset", async () => {
    const response = await compressPdf(
      multipartRequest(`${URL_BASE}/pdf/compress`, { file: await pdfFile(1), preset: "max" }),
    )
    expect(await errorCode(response)).toBe("INVALID_PRESET")
  })
})

describe("POST /api/image/convert", () => {
  it("converts images to a zip", async () => {
    const response = await convertImages(
      multipartRequest(`${URL_BASE}/image/convert`, {
        "files[]": fileOf(await makeImage("png"), "a.png", "image/png"),
        outputFormat: "jpg",
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/zip")
  })

  it("rejects SVG content", async () => {
    const response = await convertImages(
      multipartRequest(`${URL_BASE}/image/convert`, {
        "files[]": fileOf(SVG, "a.png", "image/png"),
        outputFormat: "png",
      }),
    )
    expect(await errorCode(response)).toBe("UNSUPPORTED_FORMAT")
  })
})

describe("POST /api/qrcode/generate", () => {
  const json = (body: string) =>
    new Request(`${URL_BASE}/qrcode/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    })

  it("returns a PNG", async () => {
    const response = await generateQr(json('{"payload":{"type":"text","text":"hi"}}'))
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/png")
  })

  it("rejects oversized and invalid bodies", async () => {
    const big = await generateQr(
      json(JSON.stringify({ payload: { type: "text", text: "a".repeat(70_000) } })),
    )
    expect(big.status).toBe(413)
    expect((await generateQr(json("{"))).status).toBe(400)
  })

  it("rate limits per client", async () => {
    await withEnv({ RATE_LIMIT_MAX: "1" }, async () => {
      const request = () =>
        new Request(`${URL_BASE}/qrcode/generate`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
          body: '{"payload":{"type":"text","text":"hi"}}',
        })
      const statuses = [(await generateQr(request())).status, (await generateQr(request())).status]
      expect(statuses).toContain(429)
    })
  })
})
