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
  | "UNSUPPORTED_CHARACTERS"
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

const LINE_HEIGHT_FACTOR = 1.2
const MAX_OVERLAY_CHARS = 1000
const MAX_OVERLAY_LINES = 20

/** Splits overlay text into lines, normalising CRLF/CR and expanding tabs. */
function toOverlayLines(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/\t/g, "    ").trimEnd())
}

/**
 * Bottom-left corner of the text block for a position preset,
 * clamped so the block stays on the page.
 */
function resolveOverlayPosition(
  preset: PdfEditOverlayPositionPreset,
  pageWidth: number,
  pageHeight: number,
  blockWidth: number,
  blockHeight: number,
): { x: number; y: number } {
  const margin = 36
  const maxX = Math.max(0, pageWidth - blockWidth)
  const maxY = Math.max(0, pageHeight - blockHeight)
  const top = clamp(pageHeight - margin - blockHeight, 0, maxY)
  const bottom = clamp(margin, 0, maxY)
  const left = clamp(margin, 0, maxX)
  const right = clamp(pageWidth - margin - blockWidth, 0, maxX)

  switch (preset) {
    case "top-left":
      return { x: left, y: top }
    case "top-right":
      return { x: right, y: top }
    case "bottom-left":
      return { x: left, y: bottom }
    case "bottom-right":
      return { x: right, y: bottom }
    case "center":
      return {
        x: clamp((pageWidth - blockWidth) / 2, 0, maxX),
        y: clamp((pageHeight - blockHeight) / 2, 0, maxY),
      }
  }
}

function lineAlignment(preset: PdfEditOverlayPositionPreset): "left" | "right" | "center" {
  if (preset === "top-right" || preset === "bottom-right") return "right"
  if (preset === "center") return "center"
  return "left"
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

  const lines = toOverlayLines(text)
  if (text.length > MAX_OVERLAY_CHARS || lines.length > MAX_OVERLAY_LINES) {
    throw new PdfEditOverlayError(
      "INVALID_OPTION",
      `Overlay text must be at most ${MAX_OVERLAY_CHARS} characters and ${MAX_OVERLAY_LINES} lines.`,
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
  if (pages.kind === "range" && typeof pages.range !== "string") {
    throw new PdfEditOverlayError(
      "INVALID_OPTION",
      "Pages range must be a string such as \"1-3,5\".",
      { field: "options.pages.range" },
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

  const font = await doc.embedFont(StandardFonts.Helvetica)

  // Helvetica (WinAnsi) covers Latin-1 plus a few typographic symbols.
  // Report unsupported characters (e.g. CJK, emoji) instead of a generic failure.
  const supported = new Set(font.getCharacterSet())
  const unsupported = [
    ...new Set(
      [...lines.join("")].filter((char) => !supported.has(char.codePointAt(0) ?? -1)),
    ),
  ]
  if (unsupported.length > 0) {
    const sample = unsupported.slice(0, 5).join(" ")
    throw new PdfEditOverlayError(
      "UNSUPPORTED_CHARACTERS",
      `Overlay text contains characters the PDF font cannot render: ${sample}. Only Latin characters are supported.`,
      { field: "options.text", details: unsupported.join("") },
    )
  }

  try {
    const lineHeight = fontSize * LINE_HEIGHT_FACTOR
    const lineWidths = lines.map((line) => font.widthOfTextAtSize(line, fontSize))
    const blockWidth = Math.max(...lineWidths)
    const blockHeight = fontSize + (lines.length - 1) * lineHeight
    const align = lineAlignment(position)

    for (const pageIndex of pageIndices) {
      const page = doc.getPage(pageIndex)
      const { width, height } = page.getSize()
      const { x, y } = resolveOverlayPosition(
        position,
        width,
        height,
        blockWidth,
        blockHeight,
      )

      lines.forEach((line, lineIndex) => {
        if (line.length === 0) return
        const offset =
          align === "right"
            ? blockWidth - lineWidths[lineIndex]
            : align === "center"
              ? (blockWidth - lineWidths[lineIndex]) / 2
              : 0
        page.drawText(line, {
          x: x + offset,
          // First line sits at the top of the block.
          y: y + blockHeight - fontSize - lineIndex * lineHeight,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
          opacity,
        })
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
