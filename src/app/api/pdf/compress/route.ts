import fs from "node:fs/promises"

import { NextResponse } from "next/server"

import { acquireJobSlot, checkRateLimit } from "@/lib/rate-limit"
import {
  cleanupRequestDir,
  getDefaultUploadLimits,
  persistUploadsToTemp,
  UploadError,
  validateUploadSizes,
  getMaxMultipartBodyBytes,
  readFormDataWithLimit,
} from "@/lib/upload"
import { getEnvString } from "@/lib/env"
import { compressPdfBuffer, PdfCompressError } from "@/modules/pdf/lib"
import type { PdfCompressPreset } from "@/modules/pdf/lib"

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

function internalError(
  code = "INTERNAL_ERROR",
  message = "Internal error.",
): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message } }, { status: 500 })
}

function isUploadedFile(value: FormDataEntryValue): value is File {
  return typeof value === "object" && value instanceof File
}

function parsePreset(value: FormDataEntryValue | null): PdfCompressPreset | undefined {
  if (typeof value !== "string") return undefined
  switch (value) {
    case "balanced":
    case "screen":
    case "ebook":
    case "printer":
    case "prepress":
      return value
    default:
      return undefined
  }
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
  const fileEntries = formData.getAll("file")
  const presetValue = formData.get("preset")

  if (fileEntries.length === 0) {
    return badRequest("MISSING_FILE", "Expected a PDF upload in field: file.")
  }

  if (fileEntries.length > 1) {
    return badRequest("TOO_MANY_FILES", "Only one PDF file is supported.")
  }

  const fileEntry = fileEntries[0]
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

  const preset = parsePreset(presetValue)
  if (presetValue !== null && typeof preset === "undefined") {
    return badRequest(
      "INVALID_PRESET",
      "Invalid preset. Expected one of: balanced, screen, ebook, printer, prepress.",
    )
  }

  const releaseJobSlot = await acquireJobSlot()
  if (releaseJobSlot instanceof Response) return releaseJobSlot

  let requestDir: string | undefined

  try {
    const defaultLimits = getDefaultUploadLimits()
    const limits = { ...defaultLimits, maxFiles: 1 }
    validateUploadSizes([file], limits)

    const { dir, uploads } = await persistUploadsToTemp([file], {
      extension: ".pdf",
      limits,
    })
    requestDir = dir

    const upload = uploads[0]
    const data = await fs.readFile(upload.tempPath)

    const ghostscriptPathRaw = getEnvString("GHOSTSCRIPT_PATH", "")
    const ghostscriptPath =
      ghostscriptPathRaw.trim().length > 0 ? ghostscriptPathRaw.trim() : undefined

    const compressed = await compressPdfBuffer(data, { preset, ghostscriptPath })
    const compressedBytes = new Uint8Array(compressed)

    return new NextResponse(compressedBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="compressed.pdf"',
      },
    })
  } catch (error) {
    if (error instanceof UploadError) {
      return badRequest(error.code, error.message, {
        inputIndex: error.inputIndex,
      })
    }
    if (error instanceof PdfCompressError) {
      if (error.code === "GHOSTSCRIPT_TIMEOUT") {
        // The input is too expensive to process, not a server fault.
        return NextResponse.json(
          { ok: false, error: { code: error.code, message: error.message } },
          { status: 422 },
        )
      }
      return internalError(error.code, error.message)
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
