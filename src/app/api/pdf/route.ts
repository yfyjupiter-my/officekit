import { PDFDocument } from "pdf-lib"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

export function GET() {
  return NextResponse.json(
    { ok: true, pdfLibImportable: typeof PDFDocument === "function" },
    { status: 200 },
  )
}
