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
import { mergePdfBuffers, PdfMergeError } from "@/modules/pdf/lib"

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

  const bodyLimits = getDefaultUploadLimits()
  const formData = await readFormDataWithLimit(
    request,
    getMaxMultipartBodyBytes(bodyLimits),
  )
  if (formData instanceof Response) return formData
  const entries = [
    ...formData.getAll("files[]"),
    ...formData.getAll("files"),
  ] as FormDataEntryValue[]

  if (entries.length === 0) {
    return badRequest("MISSING_FILES", "Expected 2+ PDF files in files[].")
  }

  if (!entries.every(isUploadedFile)) {
    return badRequest("INVALID_FORM_DATA", "All files[] entries must be files.")
  }

  const files = entries
  if (files.length < 2) {
    return badRequest("TOO_FEW_FILES", "At least two PDF files are required.")
  }

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    const nameLower = file.name.toLowerCase()
    const declaredPdf = file.type === "" || file.type === "application/pdf"
    const namedPdf = nameLower.endsWith(".pdf")
    if (!declaredPdf && !namedPdf) {
      return badRequest(
        "INVALID_TYPE",
        "Only PDF files are supported.",
        { inputIndex: index },
      )
    }
  }

  const releaseJobSlot = await acquireJobSlot()
  if (releaseJobSlot instanceof Response) return releaseJobSlot

  let requestDir: string | undefined

  try {
    const { dir, uploads } = await persistUploadsToTemp(files, {
      extension: ".pdf",
    })
    requestDir = dir

    const buffers: Uint8Array[] = []
    for (const upload of uploads) {
      const data = await fs.readFile(upload.tempPath)
      buffers.push(data)
    }

    const merged = await mergePdfBuffers(buffers)
    const mergedBytes = new Uint8Array(merged)

    return new NextResponse(mergedBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="merged.pdf"',
      },
    })
  } catch (error) {
    if (error instanceof UploadError) {
      return badRequest(error.code, error.message, {
        inputIndex: error.inputIndex,
      })
    }
    if (error instanceof PdfMergeError) {
      return badRequest(error.code, error.message, {
        inputIndex: error.inputIndex,
      })
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
