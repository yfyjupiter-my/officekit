import { PDFDocument } from "pdf-lib"

import { getMaxPdfPages } from "./limits"

export type PdfMergeErrorCode = "TOO_FEW_FILES" | "INVALID_PDF" | "TOO_MANY_PAGES"

export class PdfMergeError extends Error {
  readonly code: PdfMergeErrorCode
  readonly inputIndex?: number

  constructor(code: PdfMergeErrorCode, message: string, inputIndex?: number) {
    super(message)
    this.code = code
    this.inputIndex = inputIndex
  }
}

export async function mergePdfBuffers(
  pdfBuffers: readonly Uint8Array[],
): Promise<Buffer> {
  if (pdfBuffers.length < 2) {
    throw new PdfMergeError(
      "TOO_FEW_FILES",
      "At least two PDF files are required to merge.",
    )
  }

  const merged = await PDFDocument.create()
  const maxPages = getMaxPdfPages()
  let totalPages = 0

  for (let index = 0; index < pdfBuffers.length; index += 1) {
    const input = pdfBuffers[index]

    let source: PDFDocument
    try {
      source = await PDFDocument.load(input)
    } catch {
      throw new PdfMergeError(
        "INVALID_PDF",
        `Input at index ${index} is not a valid PDF.`,
        index,
      )
    }

    totalPages += source.getPageCount()
    if (totalPages > maxPages) {
      throw new PdfMergeError(
        "TOO_MANY_PAGES",
        `Merged PDF would exceed max of ${maxPages} pages.`,
        index,
      )
    }

    const copiedPages = await merged.copyPages(source, source.getPageIndices())
    for (const page of copiedPages) {
      merged.addPage(page)
    }
  }

  const bytes = await merged.save()
  return Buffer.from(bytes)
}
