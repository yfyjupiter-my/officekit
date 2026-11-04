import fs from "node:fs/promises"

import { NextResponse } from "next/server"

import { acquireJobSlot, checkRateLimit } from "@/lib/rate-limit"
import {
  cleanupRequestDir,
  getDefaultUploadLimits,
  persistUploadsToTemp,
  UploadError,
  getMaxMultipartBodyBytes,
  readFormDataWithLimit,
} from "@/lib/upload"
import { PdfSplitError, splitPdfToZipBuffer } from "@/modules/pdf/lib"

export const runtime = "nodejs"

function badRequest(
  code: string,
  message: string,
  options?: { inputIndex?: number },
): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code, message, inputIndex: options?.inputIndex } },
    { status: 400 },
  )
}

function internalError(): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code: "INTERNAL_ERROR", message: "Internal error." } },
    { status: 500 },
  )
}

function isUploadedFile(value: FormDataEntryValue): value is File {
  return typeof value === "object" && value instanceof File
}

export async function POST(request: Request): Promise<Response> {
  const rateLimited = checkRateLimit(request)
  if (rateLimited) return rateLimited

  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return badRequest(
      "INVALID_CONTENT_TYPE",
      "Expected multipart/form-data upload.",
    )
  }

  const bodyLimits = { ...getDefaultUploadLimits(), maxFiles: 1 }
  const formData = await readFormDataWithLimit(
    request,
    getMaxMultipartBodyBytes(bodyLimits),
  )
  if (formData instanceof Response) return formData
  const fileEntry = formData.get("file")

  if (!fileEntry) {
    return badRequest("MISSING_FILE", "Expected a PDF upload in field: file.")
  }

  if (!isUploadedFile(fileEntry)) {
    return badRequest("INVALID_FORM_DATA", "Field file must be a file upload.")
  }

  const file = fileEntry
  const nameLower = file.name.toLowerCase()
  const declaredPdf = file.type === "" || file.type === "application/pdf"
  const namedPdf = nameLower.endsWith(".pdf")
  if (!declaredPdf && !namedPdf) {
    return badRequest("INVALID_TYPE", "Only PDF files are supported.")
  }

  const releaseJobSlot = await acquireJobSlot()
  if (releaseJobSlot instanceof Response) return releaseJobSlot

  let requestDir: string | undefined

  try {
    const limits = getDefaultUploadLimits()
    const { dir, uploads } = await persistUploadsToTemp([file], {
      extension: ".pdf",
      limits: { ...limits, maxFiles: 1 },
    })
    requestDir = dir

    const upload = uploads[0]
    const data = await fs.readFile(upload.tempPath)

    const zip = await splitPdfToZipBuffer(data)
    const zipBytes = new Uint8Array(zip)

    return new NextResponse(zipBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="split.zip"',
      },
    })
  } catch (error) {
    if (error instanceof UploadError) {
      return badRequest(error.code, error.message, {
        inputIndex: error.inputIndex,
      })
    }
    if (error instanceof PdfSplitError) {
      return badRequest(error.code, error.message)
    }
    return internalError()
  } finally {
    releaseJobSlot()
    if (requestDir) {
      try {
        await cleanupRequestDir(requestDir)
      } catch {
      }
    }
  }
}
