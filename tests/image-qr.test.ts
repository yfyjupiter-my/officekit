import JSZip from "jszip"
import sharp from "sharp"
import { describe, expect, it } from "vitest"

import { convertImagesToZipBuffer } from "@/modules/image/lib"
import { generateQrPngBuffer } from "@/modules/qrcode"

import { makeImage, SVG, withEnv } from "./helpers"

describe("convertImagesToZipBuffer", () => {
  it("converts PNG/JPEG/WebP, strips paths/symbols, and de-duplicates names", async () => {
    const zipBuffer = await convertImagesToZipBuffer(
      [
        { name: "../holiday photo!.png", data: await makeImage("png") },
        { name: "holiday photo.jpg", data: await makeImage("jpeg") },
        { name: "x.webp", data: await makeImage("webp") },
      ],
      { outputFormat: "webp", quality: 70 },
    )
    const zip = await JSZip.loadAsync(zipBuffer)
    expect(Object.keys(zip.files).sort()).toEqual([
      "holiday photo-2.webp",
      "holiday photo.webp",
      "x.webp",
    ])
    const meta = await sharp(await zip.file("x.webp")!.async("nodebuffer")).metadata()
    expect(meta.format).toBe("webp")
  })

  it.each([
    ["svg", SVG],
    ["gif", null],
  ])("rejects %s input by content", async (_label, data) => {
    const bytes = data ?? (await makeImage("gif"))
    await expect(
      convertImagesToZipBuffer([{ name: "renamed.png", data: bytes }], { outputFormat: "png" }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT", inputIndex: 0 })
  })

  it("enforces MAX_IMAGE_PIXELS", async () => {
    await withEnv({ MAX_IMAGE_PIXELS: "100" }, async () => {
      await expect(
        convertImagesToZipBuffer([{ name: "a.png", data: await makeImage("png", 20, 20) }], {
          outputFormat: "jpg",
        }),
      ).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" })
    })
  })

  it("rejects out-of-range quality", async () => {
    await expect(
      convertImagesToZipBuffer([{ name: "a.png", data: await makeImage("png") }], {
        outputFormat: "jpg",
        quality: 0,
      }),
    ).rejects.toMatchObject({ code: "INVALID_OPTION", field: "options.quality" })
  })
})

describe("generateQrPngBuffer", () => {
  it("renders text at the requested width", async () => {
    const png = await generateQrPngBuffer({ type: "text", text: "hello" }, { width: 256 })
    expect((await sharp(png).metadata()).width).toBe(256)
  })

  it("requires a password for WPA and validates options", async () => {
    await expect(
      generateQrPngBuffer({ type: "wifi", ssid: "net", security: "WPA" }),
    ).rejects.toMatchObject({ field: "wifi.password" })
    await expect(
      generateQrPngBuffer({ type: "text", text: "x" }, { width: 10_000 }),
    ).rejects.toMatchObject({ code: "INVALID_OPTION", field: "options.width" })
    await expect(
      generateQrPngBuffer({ type: "text", text: "x" }, { foregroundColor: "red" }),
    ).rejects.toMatchObject({ field: "options.foregroundColor" })
    await expect(generateQrPngBuffer({ type: "text", text: "   " })).rejects.toMatchObject({
      code: "EMPTY_PAYLOAD",
    })
  })
})
