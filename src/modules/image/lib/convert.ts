import JSZip from "jszip"
import sharp from "sharp"

import { ImageConvertError } from "./errors"
import type { ImageConvertInput, ImageConvertOptions, ImageOutputFormat } from "./types"

type NormalizedConvertOptions =
  | { outputFormat: "png"; pngCompressionLevel: number }
  | { outputFormat: "jpg"; quality: number }
  | { outputFormat: "webp"; quality: number }

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") return error.message
  try {
    return JSON.stringify(error)
  } catch {
    return "Unknown error."
  }
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.floor(value) === value &&
    value >= min &&
    value <= max
  )
}

function normalizeOptions(options: ImageConvertOptions): NormalizedConvertOptions {
  switch (options.outputFormat) {
    case "png": {
      const value = options.pngCompressionLevel ?? 6
      if (!isIntegerInRange(value, 0, 9)) {
        throw new ImageConvertError(
          "INVALID_OPTION",
          "PNG compression level must be an integer between 0 and 9.",
          { field: "options.pngCompressionLevel" },
        )
      }
      return { outputFormat: "png", pngCompressionLevel: value }
    }
    case "jpg": {
      const value = options.quality ?? 80
      if (!isIntegerInRange(value, 1, 100)) {
        throw new ImageConvertError(
          "INVALID_OPTION",
          "JPG quality must be an integer between 1 and 100.",
          { field: "options.quality" },
        )
      }
      return { outputFormat: "jpg", quality: value }
    }
    case "webp": {
      const value = options.quality ?? 80
      if (!isIntegerInRange(value, 1, 100)) {
        throw new ImageConvertError(
          "INVALID_OPTION",
          "WEBP quality must be an integer between 1 and 100.",
          { field: "options.quality" },
        )
      }
      return { outputFormat: "webp", quality: value }
    }
  }
}

function getOutputExtension(format: ImageOutputFormat): string {
  switch (format) {
    case "png":
      return "png"
    case "jpg":
      return "jpg"
    case "webp":
      return "webp"
  }
}

function stripDirectory(name: string): string {
  const lastSlash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"))
  return lastSlash >= 0 ? name.slice(lastSlash + 1) : name
}

function stripExtension(name: string): string {
  const lastDot = name.lastIndexOf(".")
  if (lastDot <= 0) return name
  return name.slice(0, lastDot)
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

function toSafeBaseName(original: string, fallback: string): string {
  const trimmed = normalizeWhitespace(original)
  const replaced = trimmed.replace(/[^a-zA-Z0-9 _-]+/g, "-")
  const collapsed = replaced.replace(/[-_ ]{2,}/g, "-")
  const safe = collapsed.replace(/^[-_ ]+|[-_ ]+$/g, "")
  const limited = safe.length > 64 ? safe.slice(0, 64) : safe
  return limited.length > 0 ? limited : fallback
}

function deriveZipFilename(
  originalName: string,
  index: number,
  extension: string,
  used: Map<string, number>,
): string {
  const filename = stripDirectory(originalName)
  const base = stripExtension(filename)
  const fallback = `image-${String(index + 1).padStart(3, "0")}`
  const safeBase = toSafeBaseName(base, fallback)

  const previousCount = used.get(safeBase) ?? 0
  used.set(safeBase, previousCount + 1)

  const suffix = previousCount === 0 ? "" : `-${previousCount + 1}`
  return `${safeBase}${suffix}.${extension}`
}

async function convertSingleImage(
  input: ImageConvertInput,
  inputIndex: number,
  options: NormalizedConvertOptions,
): Promise<Buffer> {
  if (!(input.data instanceof Uint8Array) || input.data.length === 0) {
    throw new ImageConvertError("INVALID_IMAGE", "Input is not a valid image.", {
      field: "inputs[].data",
      inputIndex,
    })
  }

  const sourceBuffer = Buffer.from(input.data)
  const pipeline = sharp(sourceBuffer, { failOnError: true })

  try {
    await pipeline.metadata()
  } catch (error) {
    throw new ImageConvertError("INVALID_IMAGE", "Input is not a valid image.", {
      field: "inputs[].data",
      inputIndex,
      details: getErrorMessage(error),
    })
  }

  try {
    switch (options.outputFormat) {
      case "png":
        return await pipeline.png({ compressionLevel: options.pngCompressionLevel }).toBuffer()
      case "jpg":
        return await pipeline.jpeg({ quality: options.quality }).toBuffer()
      case "webp":
        return await pipeline.webp({ quality: options.quality }).toBuffer()
    }
  } catch (error) {
    throw new ImageConvertError("CONVERT_FAILED", "Image conversion failed.", {
      inputIndex,
      details: getErrorMessage(error),
    })
  }
}

export async function convertImagesToZipBuffer(
  inputs: readonly ImageConvertInput[],
  options: ImageConvertOptions,
): Promise<Buffer> {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new ImageConvertError("EMPTY_INPUT", "At least one image is required.", {
      field: "inputs",
    })
  }

  const normalized = normalizeOptions(options)
  const extension = getOutputExtension(normalized.outputFormat)

  const zip = new JSZip()
  const usedBaseNames = new Map<string, number>()

  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index]
    const bytes = await convertSingleImage(input, index, normalized)
    const filename = deriveZipFilename(input.name, index, extension, usedBaseNames)
    zip.file(filename, bytes)
  }

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  })
}
