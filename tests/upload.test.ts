import { describe, expect, it } from "vitest"

import {
  getDefaultUploadLimits,
  getMaxMultipartBodyBytes,
  readFormDataWithLimit,
  readJsonWithLimit,
  UploadError,
  validateUploadSizes,
} from "@/lib/upload"

import { withEnv } from "./helpers"

const limits = { maxFiles: 2, maxFileSizeBytes: 100, maxTotalSizeBytes: 150 }

function streamOf(bytes: number, chunk = 64): ReadableStream<Uint8Array> {
  let sent = 0
  return new ReadableStream({
    pull(controller) {
      if (sent >= bytes) return controller.close()
      const size = Math.min(chunk, bytes - sent)
      sent += size
      controller.enqueue(new Uint8Array(size))
    },
  })
}

describe("validateUploadSizes", () => {
  it("accepts files within limits", () => {
    expect(() => validateUploadSizes([{ size: 100 }, { size: 50 }], limits)).not.toThrow()
  })

  it.each([
    [[{ size: 1 }, { size: 1 }, { size: 1 }], "TOO_MANY_FILES"],
    [[{ size: 0 }], "EMPTY_FILE"],
    [[{ size: 101 }], "FILE_TOO_LARGE"],
    [[{ size: 100 }, { size: 100 }], "TOTAL_TOO_LARGE"],
  ])("rejects %j with %s", (files, code) => {
    expect(() => validateUploadSizes(files, limits)).toThrow(
      expect.objectContaining({ code }) as unknown as UploadError,
    )
  })
})

describe("getDefaultUploadLimits", () => {
  it("falls back to defaults for non-positive env values", async () => {
    await withEnv({ MAX_FILES: "0", MAX_FILE_SIZE: "-5", MAX_TOTAL_UPLOAD_SIZE: "abc" }, () => {
      expect(getDefaultUploadLimits()).toEqual({
        maxFiles: 10,
        maxFileSizeBytes: 25 * 1024 * 1024,
        maxTotalSizeBytes: 100 * 1024 * 1024,
      })
    })
  })

  it("caps multipart body at the smaller of per-file and total limits", () => {
    expect(getMaxMultipartBodyBytes(limits)).toBe(150 + 1024 * 1024)
  })
})

describe("readFormDataWithLimit", () => {
  it("parses a body within the limit", async () => {
    const form = new FormData()
    form.append("name", "value")
    const result = await readFormDataWithLimit(
      new Request("http://x/", { method: "POST", body: form }),
      10_000,
    )
    expect(result).toBeInstanceOf(FormData)
    expect((result as FormData).get("name")).toBe("value")
  })

  it("rejects a declared Content-Length over the limit without reading", async () => {
    const request = new Request("http://x/", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": "5000" },
      body: "never read",
    })
    const result = await readFormDataWithLimit(request, 1000)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(413)
    expect(request.bodyUsed).toBe(false)
  })

  it("stops a chunked body that exceeds the limit", async () => {
    const request = new Request("http://x/", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body: streamOf(10_000),
      duplex: "half",
    } as RequestInit)
    const result = await readFormDataWithLimit(request, 1000)
    expect((result as Response).status).toBe(413)
  })

  it("returns 400 for a malformed body", async () => {
    const request = new Request("http://x/", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body: "garbage",
    })
    const result = await readFormDataWithLimit(request, 1000)
    expect((result as Response).status).toBe(400)
  })
})

describe("readJsonWithLimit", () => {
  it("parses JSON within the limit", async () => {
    const result = await readJsonWithLimit(
      new Request("http://x/", { method: "POST", body: '{"a":1}' }),
    )
    expect(result).toEqual({ value: { a: 1 } })
  })

  it("rejects oversize and invalid JSON", async () => {
    const big = await readJsonWithLimit(
      new Request("http://x/", { method: "POST", body: JSON.stringify("a".repeat(100)) }),
      50,
    )
    expect((big as Response).status).toBe(413)
    const bad = await readJsonWithLimit(new Request("http://x/", { method: "POST", body: "{" }))
    expect((bad as Response).status).toBe(400)
  })
})
