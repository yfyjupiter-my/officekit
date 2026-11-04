import { PDFDocument, rgb, StandardFonts } from "pdf-lib"

import { getMaxPdfPages } from "./limits"

export type PdfEditOverlayPositionPreset =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "center"

export type PdfEditPageSelection =
  | { kind: "all" }
  | { kind: "range"; range: string }

export type PdfEditOverlayOptions = {
  text: string
  fontSize: number
  opacity: number
  position: PdfEditOverlayPositionPreset
  pages: PdfEditPageSelection
}

export type PdfEditOverlayErrorCode =
  | "INVALID_PDF"
  | "EMPTY_PDF"
  | "INVALID_OPTION"
  | "INVALID_PAGE_RANGE"
  | "TOO_MANY_PAGES"
  | "OVERLAY_FAILED"

export type PdfEditOverlayErrorField =
  | "input"
  | "options.text"
  | "options.fontSize"
  | "options.opacity"
  | "options.position"
  | "options.pages"
  | "options.pages.range"

export class PdfEditOverlayError extends Error {
  readonly code: PdfEditOverlayErrorCode
  readonly field?: PdfEditOverlayErrorField
  readonly details?: string

  constructor(
    code: PdfEditOverlayErrorCode,
    message: string,
    options?: { field?: PdfEditOverlayErrorField; details?: string },
  ) {
    super(message)
    this.code = code
    this.field = options?.field
    this.details = options?.details
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function parsePageRangeToIndices(range: string, pageCount: number): number[] {
  const raw = range.trim()
  if (raw.length === 0) {
    throw new PdfEditOverlayError(
      "INVALID_PAGE_RANGE",
      "Page range must not be empty.",
      { field: "options.pages.range" },
    )
  }

  if (pageCount <= 0) {
    throw new PdfEditOverlayError("EMPTY_PDF", "PDF contains no pages.", {
      field: "input",
    })
  }

  const seen = new Set<number>()
  const indices: number[] = []

  for (const part of raw.split(",")) {
    const token = part.trim()
    if (token.length === 0) {
      throw new PdfEditOverlayError(
        "INVALID_PAGE_RANGE",
        "Page range contains an empty segment.",
        { field: "options.pages.range", details: range },
      )
    }

    const singleMatch = /^\d+$/.exec(token)
    if (singleMatch) {
      const pageNumber = Number(token)
      if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) {
        throw new PdfEditOverlayError(
          "INVALID_PAGE_RANGE",
          "Page numbers must be positive integers.",
          { field: "options.pages.range", details: token },
        )
      }
      if (pageNumber > pageCount) {
        throw new PdfEditOverlayError(
          "INVALID_PAGE_RANGE",
          "Page range is out of bounds.",
          { field: "options.pages.range", details: token },
        )
      }

      const index = pageNumber - 1
      if (!seen.has(index)) {
        seen.add(index)
        indices.push(index)
      }
      continue
    }

    const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(token)
    if (!rangeMatch) {
      throw new PdfEditOverlayError(
        "INVALID_PAGE_RANGE",
        "Page range must use comma-separated numbers or hyphen ranges (e.g. 1-3,5).",
        { field: "options.pages.range", details: token },
      )
    }

    const start = Number(rangeMatch[1])
    const end = Number(rangeMatch[2])

    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 1 ||
      end < 1
    ) {
      throw new PdfEditOverlayError(
        "INVALID_PAGE_RANGE",
        "Range endpoints must be positive integers.",
        { field: "options.pages.range", details: token },
      )
    }

    if (start > end) {
      throw new PdfEditOverlayError(
        "INVALID_PAGE_RANGE",
        "Range start must be less than or equal to range end.",
        { field: "options.pages.range", details: token },
      )
    }

    if (end > pageCount) {
      throw new PdfEditOverlayError(
        "INVALID_PAGE_RANGE",
        "Page range is out of bounds.",
        { field: "options.pages.range", details: token },
      )
    }

    for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
      const index = pageNumber - 1
      if (!seen.has(index)) {
        seen.add(index)
        indices.push(index)
      }
    }
  }

  if (indices.length === 0) {
    throw new PdfEditOverlayError(
      "INVALID_PAGE_RANGE",
      "Page selection results in no pages.",
      { field: "options.pages.range", details: range },
    )
  }

  return indices
}

function resolvePageIndices(
  pages: PdfEditPageSelection,
  pageCount: number,
): number[] {
  if (pages.kind === "all") {
    if (pageCount <= 0) {
      throw new PdfEditOverlayError("EMPTY_PDF", "PDF contains no pages.", {
        field: "input",
      })
    }
    return Array.from({ length: pageCount }, (_, index) => index)
  }

  return parsePageRangeToIndices(pages.range, pageCount)
}

function resolveOverlayPosition(
  preset: PdfEditOverlayPositionPreset,
  pageWidth: number,
  pageHeight: number,
  textWidth: number,
  fontSize: number,
): { x: number; y: number } {
  const margin = 36
  const maxX = Math.max(0, pageWidth - textWidth)
  const maxY = Math.max(0, pageHeight - fontSize)

  switch (preset) {
    case "top-left":
      return { x: clamp(margin, 0, maxX), y: clamp(pageHeight - margin - fontSize, 0, maxY) }
    case "top-right":
      return { x: clamp(pageWidth - margin - textWidth, 0, maxX), y: clamp(pageHeight - margin - fontSize, 0, maxY) }
    case "bottom-left":
      return { x: clamp(margin, 0, maxX), y: clamp(margin, 0, maxY) }
    case "bottom-right":
      return { x: clamp(pageWidth - margin - textWidth, 0, maxX), y: clamp(margin, 0, maxY) }
    case "center":
      return { x: clamp((pageWidth - textWidth) / 2, 0, maxX), y: clamp((pageHeight - fontSize) / 2, 0, maxY) }
  }
}

export async function overlayTextOnPdfBuffer(
  pdfBuffer: Uint8Array,
  options: PdfEditOverlayOptions,
): Promise<Buffer> {
  const text = typeof options.text === "string" ? options.text.trim() : ""
  if (text.length === 0) {
    throw new PdfEditOverlayError(
      "INVALID_OPTION",
      "Overlay text must not be empty.",
      { field: "options.text" },
    )
  }

  const fontSize = options.fontSize
  if (
    typeof fontSize !== "number" ||
    !Number.isFinite(fontSize) ||
    fontSize < 4 ||
    fontSize > 200
  ) {
    throw new PdfEditOverlayError(
      "INVALID_OPTION",
      "Font size must be a number between 4 and 200.",
      { field: "options.fontSize" },
    )
  }

  const opacity = options.opacity
  if (
    typeof opacity !== "number" ||
    !Number.isFinite(opacity) ||
    opacity < 0 ||
    opacity > 1
  ) {
    throw new PdfEditOverlayError(
      "INVALID_OPTION",
      "Opacity must be a number between 0 and 1.",
      { field: "options.opacity" },
    )
  }

  const position = options.position
  const allowedPositions: readonly PdfEditOverlayPositionPreset[] = [
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right",
    "center",
  ]
  if (!allowedPositions.includes(position)) {
    throw new PdfEditOverlayError(
      "INVALID_OPTION",
      "Position must be a supported preset.",
      { field: "options.position" },
    )
  }

  const pages = options.pages
  if (
    typeof pages !== "object" ||
    pages === null ||
    (pages.kind !== "all" && pages.kind !== "range")
  ) {
    throw new PdfEditOverlayError(
      "INVALID_OPTION",
      "Pages must be either { kind: \"all\" } or { kind: \"range\", range: \"1-3,5\" }.",
      { field: "options.pages" },
    )
  }

  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(pdfBuffer)
  } catch {
    throw new PdfEditOverlayError("INVALID_PDF", "Input is not a valid PDF.", {
      field: "input",
    })
  }

  const pageCount = doc.getPageCount()
  const maxPages = getMaxPdfPages()
  if (pageCount > maxPages) {
    throw new PdfEditOverlayError(
      "TOO_MANY_PAGES",
      `PDF has ${pageCount} pages; max is ${maxPages}.`,
      { field: "input" },
    )
  }
  const pageIndices =
    pages.kind === "all"
      ? resolvePageIndices({ kind: "all" }, pageCount)
      : resolvePageIndices({ kind: "range", range: pages.range }, pageCount)

  try {
    const font = await doc.embedFont(StandardFonts.Helvetica)

    for (const pageIndex of pageIndices) {
      const page = doc.getPage(pageIndex)
      const { width, height } = page.getSize()
      const textWidth = font.widthOfTextAtSize(text, fontSize)
      const { x, y } = resolveOverlayPosition(
        position,
        width,
        height,
        textWidth,
        fontSize,
      )

      page.drawText(text, {
        x,
        y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
        opacity,
      })
    }

    const bytes = await doc.save()
    return Buffer.from(bytes)
  } catch (error) {
    const details = error instanceof Error ? error.message : undefined
    throw new PdfEditOverlayError(
      "OVERLAY_FAILED",
      "Failed to apply text overlay.",
      { details },
    )
  }
}
