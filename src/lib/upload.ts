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
}

export interface UploadMeta {
  originalName: string
  size: number
  tempPath: string
}

export class UploadError extends Error {
  readonly code:
    | "TOO_MANY_FILES"
    | "FILE_TOO_LARGE"
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

export function getDefaultUploadLimits(): UploadLimits {
  return {
    maxFiles: getEnvInt("MAX_FILES", 10),
    maxFileSizeBytes: getEnvInt("MAX_FILE_SIZE", 25 * 1024 * 1024),
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
