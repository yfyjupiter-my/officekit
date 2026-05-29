import fs from "node:fs/promises"

import { NextResponse } from "next/server"

import {
  cleanupRequestDir,
  getDefaultUploadLimits,
  persistUploadsToTemp,
  UploadError,
  validateUploadSizes,
} from "@/lib/upload"
import { overlayTextOnPdfBuffer, PdfEditOverlayError } from "@/modules/pdf/lib"
import type { PdfEditOverlayOptions } from "@/modules/pdf/lib"

export const runtime = "nodejs"

type ApiErrorShape = {
  ok: false
  error: {
    code: string
    message: string
    field?: string
    inputIndex?: number
  }
}

function badRequest(
  code: string,
  message: string,
  options?: { field?: string; inputIndex?: number },
): NextResponse<ApiErrorShape> {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
        field: options?.field,
        inputIndex: options?.inputIndex,
      },
    },
    { status: 400 },
  )
}

function internalError(): NextResponse<ApiErrorShape> {
  return NextResponse.json(
    { ok: false, error: { code: "INTERNAL_ERROR", message: "Internal error." } },
    { status: 500 },
  )
}

function isUploadedFile(value: FormDataEntryValue): value is File {
  return typeof value === "object" && value instanceof File
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

class ApiBadRequestError extends Error {
  readonly code: string
  readonly field?: string
  readonly inputIndex?: number

  constructor(
    code: string,
    message: string,
    options?: { field?: string; inputIndex?: number },
  ) {
    super(message)
    this.code = code
    this.field = options?.field
    this.inputIndex = options?.inputIndex
  }
}

function parseOptions(value: FormDataEntryValue | null): PdfEditOverlayOptions {
  if (value === null) {
    throw new ApiBadRequestError(
      "MISSING_OPTIONS",
      "Expected options JSON string in field: options.",
      { field: "options" },
    )
  }

  if (typeof value !== "string") {
    throw new ApiBadRequestError(
      "INVALID_FORM_DATA",
      "Field options must be a JSON string.",
      { field: "options" },
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new ApiBadRequestError(
      "INVALID_OPTIONS_JSON",
      "Invalid JSON in field: options.",
      { field: "options" },
    )
  }

  if (!isRecord(parsed)) {
    throw new ApiBadRequestError(
      "INVALID_OPTIONS",
      "Options must be a JSON object.",
      { field: "options" },
    )
  }

  return parsed as PdfEditOverlayOptions
}

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return badRequest(
      "INVALID_CONTENT_TYPE",
      "Expected multipart/form-data upload.",
    )
  }

  const formData = await request.formData()
  const fileEntries = formData.getAll("file")
  const optionsValue = formData.get("options")

  if (fileEntries.length === 0) {
    return badRequest("MISSING_FILE", "Expected a PDF upload in field: file.", {
      field: "file",
    })
  }

  if (fileEntries.length > 1) {
    return badRequest("TOO_MANY_FILES", "Only one PDF file is supported.", {
      field: "file",
    })
  }

  const fileEntry = fileEntries[0]
  if (!isUploadedFile(fileEntry)) {
    return badRequest("INVALID_FORM_DATA", "Field file must be a file upload.", {
      field: "file",
    })
  }

  const file = fileEntry
  const nameLower = file.name.toLowerCase()
  const declaredPdf = file.type === "" || file.type === "application/pdf"
  const namedPdf = nameLower.endsWith(".pdf")
  if (!declaredPdf && !namedPdf) {
    return badRequest("INVALID_TYPE", "Only PDF files are supported.", {
      field: "file",
    })
  }

  let requestDir: string | undefined

  try {
    const options = parseOptions(optionsValue)

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

    const edited = await overlayTextOnPdfBuffer(data, options)
    const editedBytes = new Uint8Array(edited)

    return new NextResponse(editedBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="edited.pdf"',
      },
    })
  } catch (error) {
    if (error instanceof ApiBadRequestError) {
      return badRequest(error.code, error.message, {
        field: error.field,
        inputIndex: error.inputIndex,
      })
    }
    if (error instanceof UploadError) {
      return badRequest(error.code, error.message, {
        field: "file",
        inputIndex: error.inputIndex,
      })
    }
    if (error instanceof PdfEditOverlayError) {
      const field = error.field === "input" ? "file" : error.field
      return badRequest(error.code, error.message, { field })
    }
    return internalError()
  } finally {
    if (requestDir) {
      try {
        await cleanupRequestDir(requestDir)
      } catch {
      }
    }
  }
}
