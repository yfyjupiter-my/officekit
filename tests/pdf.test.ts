import JSZip from "jszip"
import { describe, expect, it } from "vitest"

import {
  compressPdfBuffer,
  mergePdfBuffers,
  overlayTextOnPdfBuffer,
  splitPdfToZipBuffer,
} from "@/modules/pdf/lib"
import type { PdfEditOverlayOptions } from "@/modules/pdf/lib"

import { hasGhostscript, makePdf, pageCount, withEnv } from "./helpers"

const NOT_PDF = new TextEncoder().encode("not a pdf")

function overlay(overrides: Partial<PdfEditOverlayOptions> = {}): PdfEditOverlayOptions {
  return {
    text: "Draft",
    fontSize: 24,
    opacity: 0.8,
    position: "bottom-right",
    pages: { kind: "all" },
    ...overrides,
  }
}

describe("mergePdfBuffers", () => {
  it("concatenates pages", async () => {
    const merged = await mergePdfBuffers([await makePdf(2), await makePdf(3)])
    expect(await pageCount(merged)).toBe(5)
  })

  it("reports which input is invalid", async () => {
    await expect(mergePdfBuffers([await makePdf(1), NOT_PDF])).rejects.toMatchObject({
      code: "INVALID_PDF",
      inputIndex: 1,
    })
  })

  it("enforces MAX_PDF_PAGES across inputs", async () => {
    await withEnv({ MAX_PDF_PAGES: "4" }, async () => {
      await expect(mergePdfBuffers([await makePdf(2), await makePdf(3)])).rejects.toMatchObject({
        code: "TOO_MANY_PAGES",
        inputIndex: 1,
      })
    })
  })
})

describe("splitPdfToZipBuffer", () => {
  it("produces one single-page PDF per page", async () => {
    const zip = await JSZip.loadAsync(await splitPdfToZipBuffer(await makePdf(3)))
    const names = Object.keys(zip.files).sort()
    expect(names).toEqual(["page-001.pdf", "page-002.pdf", "page-003.pdf"])
    expect(await pageCount(await zip.file("page-002.pdf")!.async("uint8array"))).toBe(1)
  })

  it("rejects invalid input and too many pages", async () => {
    await expect(splitPdfToZipBuffer(NOT_PDF)).rejects.toMatchObject({ code: "INVALID_PDF" })
    await withEnv({ MAX_PDF_PAGES: "2" }, async () => {
      await expect(splitPdfToZipBuffer(await makePdf(3))).rejects.toMatchObject({
        code: "TOO_MANY_PAGES",
      })
    })
  })
})

describe("overlayTextOnPdfBuffer", () => {
  it("draws text on every position, including multi-line text with tabs", async () => {
    for (const position of ["top-left", "top-right", "bottom-left", "bottom-right", "center"] as const) {
      const out = await overlayTextOnPdfBuffer(
        await makePdf(2),
        overlay({ position, text: "Line one\r\nsecond\tline" }),
      )
      expect(await pageCount(out)).toBe(2)
    }
  })

  it("accepts Latin-1 and typographic characters", async () => {
    await expect(
      overlayTextOnPdfBuffer(await makePdf(1), overlay({ text: "Café – “Entwurf” €" })),
    ).resolves.toBeInstanceOf(Buffer)
  })

  it("rejects characters the font cannot render", async () => {
    await expect(
      overlayTextOnPdfBuffer(await makePdf(1), overlay({ text: "你好 😀" })),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_CHARACTERS", field: "options.text" })
  })

  it.each([
    [{ text: "   " }, "options.text"],
    [{ text: Array(21).fill("x").join("\n") }, "options.text"],
    [{ fontSize: 3 }, "options.fontSize"],
    [{ opacity: 2 }, "options.opacity"],
    [{ position: "middle" as never }, "options.position"],
    [{ pages: { kind: "range" } as never }, "options.pages.range"],
  ])("rejects invalid option %j", async (overrides, field) => {
    await expect(
      overlayTextOnPdfBuffer(await makePdf(1), overlay(overrides)),
    ).rejects.toMatchObject({ code: "INVALID_OPTION", field })
  })

  it.each(["", "0", "3-1", "1,,2", "5", "a-b"])("rejects page range %j", async (range) => {
    await expect(
      overlayTextOnPdfBuffer(await makePdf(3), overlay({ pages: { kind: "range", range } })),
    ).rejects.toMatchObject({ code: "INVALID_PAGE_RANGE" })
  })

  it("accepts a valid page range", async () => {
    const out = await overlayTextOnPdfBuffer(
      await makePdf(3),
      overlay({ pages: { kind: "range", range: "1, 2-3" } }),
    )
    expect(await pageCount(out)).toBe(3)
  })
})

describe.skipIf(!hasGhostscript())("compressPdfBuffer (Ghostscript)", () => {
  it("never returns a larger file", async () => {
    const input = await makePdf(2)
    const result = await compressPdfBuffer(input, { preset: "screen" })
    expect(result.data.length).toBeLessThanOrEqual(input.length)
    if (!result.compressed) expect(Buffer.compare(result.data, Buffer.from(input))).toBe(0)
  })

  it("rejects input without a PDF header", async () => {
    await expect(compressPdfBuffer(NOT_PDF)).rejects.toMatchObject({ code: "INVALID_PDF" })
  })
})
