import fs from "node:fs/promises"

import { NextResponse } from "next/server"

import {
  cleanupRequestDir,
  getDefaultUploadLimits,
  persistUploadsToTemp,
  UploadError,
  validateUploadSizes,
  getMaxMultipartBodyBytes,
  readFormDataWithLimit,
} from "@/lib/upload"
import { convertImagesToZipBuffer, ImageConvertError } from "@/modules/image/lib"
import type {
  ImageConvertErrorField,
  ImageConvertOptions,
  ImageOutputFormat,
} from "@/modules/image/lib"

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
    { ok: false, error: { code, message, field: options?.field, inputIndex: options?.inputIndex } },
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

function isImageName(name: string): boolean {
  const lowered = name.toLowerCase()
  return (
    lowered.endsWith(".png") ||
    lowered.endsWith(".jpg") ||
    lowered.endsWith(".jpeg") ||
    lowered.endsWith(".webp")
  )
}

function parseIntField(
  value: FormDataEntryValue | null,
  field: ImageConvertErrorField,
  options?: { min?: number; max?: number },
): number | undefined {
  if (value === null) return undefined
  if (typeof value !== "string") {
    throw new ImageConvertError("INVALID_OPTION", "Option must be a string.", { field })
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined

  if (!/^\d+$/.test(trimmed)) {
    throw new ImageConvertError("INVALID_OPTION", "Option must be an integer.", { field })
  }

  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsed)) {
    throw new ImageConvertError("INVALID_OPTION", "Option must be an integer.", { field })
  }

  if (
    typeof options?.min === "number" &&
    typeof options?.max === "number" &&
    (parsed < options.min || parsed > options.max)
  ) {
    throw new ImageConvertError(
      "INVALID_OPTION",
      `Option must be between ${options.min} and ${options.max}.`,
      { field },
    )
  }

  return parsed
}

function parseOutputFormat(value: FormDataEntryValue | null): ImageOutputFormat {
  if (value === null) {
    throw new ImageConvertError(
      "INVALID_OPTION",
      "Missing output format. Expected: png, jpg, webp.",
      { field: "options.outputFormat" },
    )
  }
  if (typeof value !== "string") {
    throw new ImageConvertError("INVALID_OPTION", "Output format must be a string.", {
      field: "options.outputFormat",
    })
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === "png" || normalized === "jpg" || normalized === "webp") {
    return normalized
  }

  throw new ImageConvertError("INVALID_OPTION", "Invalid output format.", {
    field: "options.outputFormat",
  })
}

function parseOptions(formData: FormData): ImageConvertOptions {
  const outputFormat = parseOutputFormat(formData.get("outputFormat"))

  if (outputFormat === "png") {
    const pngCompressionLevel = parseIntField(
      formData.get("pngCompressionLevel"),
      "options.pngCompressionLevel",
      { min: 0, max: 9 },
    )
    return { outputFormat, pngCompressionLevel }
  }

  const quality = parseIntField(formData.get("quality"), "options.quality", {
    min: 1,
    max: 100,
  })
  return { outputFormat, quality }
}

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return badRequest("INVALID_CONTENT_TYPE", "Expected multipart/form-data upload.")
  }

  const bodyLimits = getDefaultUploadLimits()
  const formData = await readFormDataWithLimit(
    request,
    getMaxMultipartBodyBytes(bodyLimits),
  )
  if (formData instanceof Response) return formData
  const entries = [...formData.getAll("files[]"), ...formData.getAll("files")] as FormDataEntryValue[]

  if (entries.length === 0) {
    return badRequest("MISSING_FILES", "Expected 1+ image files in files[].")
  }

  if (!entries.every(isUploadedFile)) {
    return badRequest("INVALID_FORM_DATA", "All files[] entries must be files.")
  }

  const files = entries
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    const declaredImage = file.type === "" || file.type.toLowerCase().startsWith("image/")
    const namedImage = isImageName(file.name)
    if (!declaredImage && !namedImage) {
      return badRequest("INVALID_TYPE", "Only image files are supported.", { inputIndex: index })
    }
  }

  let requestDir: string | undefined

  try {
    const options = parseOptions(formData)

    const limits = getDefaultUploadLimits()
    validateUploadSizes(files, limits)

    const { dir, uploads } = await persistUploadsToTemp(files, {
      extension: ".bin",
      limits,
    })
    requestDir = dir

    const inputs: { name: string; data: Uint8Array }[] = []
    for (const upload of uploads) {
      const data = await fs.readFile(upload.tempPath)
      inputs.push({ name: upload.originalName, data })
    }

    const zip = await convertImagesToZipBuffer(inputs, options)
    const zipBytes = new Uint8Array(zip)

    return new NextResponse(zipBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="converted.zip"',
      },
    })
  } catch (error) {
    if (error instanceof UploadError) {
      return badRequest(error.code, error.message, { inputIndex: error.inputIndex })
    }
    if (error instanceof ImageConvertError) {
      return badRequest(error.code, error.message, {
        field: error.field,
        inputIndex: error.inputIndex,
      })
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
