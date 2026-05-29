import JSZip from "jszip"
import { PDFDocument } from "pdf-lib"

export type PdfSplitErrorCode = "INVALID_PDF" | "EMPTY_PDF"

export class PdfSplitError extends Error {
  readonly code: PdfSplitErrorCode

  constructor(code: PdfSplitErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

function formatPageFilename(pageIndex: number, pageCount: number): string {
  const digits = Math.max(3, String(pageCount).length)
  const pageNumber = String(pageIndex + 1).padStart(digits, "0")
  return `page-${pageNumber}.pdf`
}

export async function splitPdfToZipBuffer(
  pdfBuffer: Uint8Array,
): Promise<Buffer> {
  let source: PDFDocument
  try {
    source = await PDFDocument.load(pdfBuffer)
  } catch {
    throw new PdfSplitError("INVALID_PDF", "Input is not a valid PDF.")
  }

  const pageCount = source.getPageCount()
  if (pageCount === 0) {
    throw new PdfSplitError("EMPTY_PDF", "PDF contains no pages.")
  }

  const zip = new JSZip()

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const part = await PDFDocument.create()
    const [page] = await part.copyPages(source, [pageIndex])
    part.addPage(page)

    const bytes = await part.save()
    zip.file(formatPageFilename(pageIndex, pageCount), Buffer.from(bytes))
  }

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  })
}

