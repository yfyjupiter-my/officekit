import path from "node:path"
import { pipeline } from "node:stream/promises"
import { Readable } from "node:stream"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import crypto from "node:crypto"
import fs from "node:fs/promises"

import { getEnvInt, getEnvString } from "@/lib/env"

export interface UploadLimits {
  maxFiles: number
  maxFileSizeBytes: number
  /** Cap on the combined size of all files in one request. */
  maxTotalSizeBytes?: number
}

const DEFAULT_MAX_FILES = 10
const DEFAULT_MAX_FILE_SIZE = 25 * 1024 * 1024
const DEFAULT_MAX_TOTAL_UPLOAD_SIZE = 100 * 1024 * 1024
/** Allowance for multipart boundaries, part headers and small text fields. */
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024
const DEFAULT_MAX_JSON_BODY_BYTES = 64 * 1024

export interface UploadMeta {
  originalName: string
  size: number
  tempPath: string
}

export class UploadError extends Error {
  readonly code:
    | "TOO_MANY_FILES"
    | "FILE_TOO_LARGE"
    | "TOTAL_TOO_LARGE"
    | "EMPTY_FILE"
    | "WRITE_FAILED"

  constructor(
    code: UploadError["code"],
    message: string,
    readonly inputIndex?: number,
  ) {
    super(message)
    this.code = code
  }
}

function getPositiveEnvInt(name: string, fallback: number): number {
  const value = getEnvInt(name, fallback)
  return value > 0 ? value : fallback
}

export function getDefaultUploadLimits(): UploadLimits {
  return {
    maxFiles: getPositiveEnvInt("MAX_FILES", DEFAULT_MAX_FILES),
    maxFileSizeBytes: getPositiveEnvInt("MAX_FILE_SIZE", DEFAULT_MAX_FILE_SIZE),
    maxTotalSizeBytes: getPositiveEnvInt(
      "MAX_TOTAL_UPLOAD_SIZE",
      DEFAULT_MAX_TOTAL_UPLOAD_SIZE,
    ),
  }
}

/**
 * Largest request body (in bytes) a multipart upload route should accept
 * for the given limits, including multipart framing overhead.
 */
export function getMaxMultipartBodyBytes(limits: UploadLimits): number {
  const perFileTotal = limits.maxFiles * limits.maxFileSizeBytes
  const total =
    typeof limits.maxTotalSizeBytes === "number"
      ? Math.min(perFileTotal, limits.maxTotalSizeBytes)
      : perFileTotal
  return total + MULTIPART_OVERHEAD_BYTES
}

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } }, { status })
}

function requestTooLarge(maxBytes: number): Response {
  return jsonError(
    413,
    "REQUEST_TOO_LARGE",
    `Request body exceeds max size of ${maxBytes} bytes.`,
  )
}

/**
 * Reads the request body while enforcing a byte cap, so oversized uploads are
 * rejected before they are buffered in memory. Rejects early on a declared
 * Content-Length and also counts bytes for chunked / undeclared bodies; the
 * returned stream errors (and `exceeded()` turns true) once the cap is crossed.
 */
function limitBody(
  request: Request,
  maxBytes: number,
): { body: ReadableStream<Uint8Array>; exceeded: () => boolean } | "too-large" | "no-body" {
  const declared = request.headers.get("content-length")
  if (declared !== null) {
    const declaredBytes = Number(declared)
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) return "too-large"
  }

  if (!request.body) return "no-body"

  let received = 0
  let exceeded = false
  const body = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength
        if (received > maxBytes) {
          exceeded = true
          controller.error(new Error("Request body too large."))
          return
        }
        controller.enqueue(chunk)
      },
    }),
  )
  return { body, exceeded: () => exceeded }
}

/**
 * Parses multipart/form-data with a body size cap.
 * Returns the FormData, or a ready-to-send error Response
 * (413 when too large, 400 when the body is missing or malformed).
 */
export async function readFormDataWithLimit(
  request: Request,
  maxBytes: number,
): Promise<FormData | Response> {
  const limited = limitBody(request, maxBytes)
  if (limited === "too-large") return requestTooLarge(maxBytes)
  if (limited === "no-body") {
    return jsonError(400, "INVALID_FORM_DATA", "Expected a multipart/form-data body.")
  }

  try {
    return await new Response(limited.body, {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData()
  } catch {
    if (limited.exceeded()) return requestTooLarge(maxBytes)
    return jsonError(400, "INVALID_FORM_DATA", "Malformed multipart/form-data body.")
  }
}

/**
 * Parses a JSON body with a size cap. Returns `{ value }` on success,
 * or a ready-to-send error Response (413 too large, 400 invalid JSON).
 */
export async function readJsonWithLimit(
  request: Request,
  maxBytes: number = DEFAULT_MAX_JSON_BODY_BYTES,
): Promise<{ value: unknown } | Response> {
  const limited = limitBody(request, maxBytes)
  if (limited === "too-large") return requestTooLarge(maxBytes)
  if (limited === "no-body") return jsonError(400, "INVALID_JSON", "Invalid JSON body.")

  let text: string
  try {
    text = await new Response(limited.body).text()
  } catch {
    if (limited.exceeded()) return requestTooLarge(maxBytes)
    return jsonError(400, "INVALID_JSON", "Invalid JSON body.")
  }

  try {
    return { value: JSON.parse(text) as unknown }
  } catch {
    return jsonError(400, "INVALID_JSON", "Invalid JSON body.")
  }
}

export function getUploadDir(): string {
  return getEnvString(
    "UPLOAD_DIR",
    path.join(process.cwd(), ".tmp", "uploads"),
  )
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

export async function createRequestUploadDir(
  baseDir: string,
): Promise<{ requestId: string; dir: string }> {
  const requestId = crypto.randomUUID()
  const dir = path.join(baseDir, requestId)
  await ensureDir(dir)
  return { requestId, dir }
}

export async function cleanupRequestDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true })
}

export function validateUploadSizes(
  files: readonly { size: number }[],
  limits: UploadLimits,
): void {
  if (files.length > limits.maxFiles) {
    throw new UploadError(
      "TOO_MANY_FILES",
      `Too many files. Max is ${limits.maxFiles}.`,
    )
  }

  let totalSize = 0
  for (let index = 0; index < files.length; index += 1) {
    const size = files[index].size
    if (size <= 0) {
      throw new UploadError("EMPTY_FILE", "Empty file.", index)
    }
    if (size > limits.maxFileSizeBytes) {
      throw new UploadError(
        "FILE_TOO_LARGE",
        `File exceeds max size of ${limits.maxFileSizeBytes} bytes.`,
        index,
      )
    }
    totalSize += size
  }

  if (
    typeof limits.maxTotalSizeBytes === "number" &&
    totalSize > limits.maxTotalSizeBytes
  ) {
    throw new UploadError(
      "TOTAL_TOO_LARGE",
      `Combined upload size exceeds max of ${limits.maxTotalSizeBytes} bytes.`,
    )
  }
}

export function createTempFilePath(dir: string, extension: string): string {
  const safeExt = extension.startsWith(".") ? extension : `.${extension}`
  const fileName = `${crypto.randomUUID()}${safeExt}`
  return path.join(dir, fileName)
}

export async function writeWebFileToDisk(
  file: File,
  destPath: string,
): Promise<void> {
  try {
    const readable = Readable.fromWeb(
      file.stream() as unknown as NodeReadableStream<Uint8Array>,
    )
    const writable = (await import("node:fs")).createWriteStream(destPath, {
      flags: "wx",
    })
    await pipeline(readable, writable)
  } catch (error) {
    throw new UploadError(
      "WRITE_FAILED",
      error instanceof Error ? error.message : "Failed to write upload.",
    )
  }
}

export async function persistUploadsToTemp(
  files: readonly File[],
  options?: {
    limits?: UploadLimits
    baseDir?: string
    extension?: string
  },
): Promise<{
  requestId: string
  dir: string
  uploads: UploadMeta[]
}> {
  const limits = options?.limits ?? getDefaultUploadLimits()
  const baseDir = options?.baseDir ?? getUploadDir()
  const extension = options?.extension ?? ".bin"

  await ensureDir(baseDir)
  validateUploadSizes(files, limits)

  const { requestId, dir } = await createRequestUploadDir(baseDir)
  const uploads: UploadMeta[] = []

  try {
    for (const file of files) {
      const tempPath = createTempFilePath(dir, extension)
      await writeWebFileToDisk(file, tempPath)
      uploads.push({
        originalName: file.name,
        size: file.size,
        tempPath,
      })
    }

    return { requestId, dir, uploads }
  } catch (error) {
    await cleanupRequestDir(dir)
    throw error
  }
}
