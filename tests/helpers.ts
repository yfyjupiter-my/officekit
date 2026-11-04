import { execFileSync } from "node:child_process"

import { PDFDocument } from "pdf-lib"
import sharp from "sharp"

export async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let index = 0; index < pages; index += 1) doc.addPage()
  return doc.save()
}

export async function pageCount(data: Uint8Array): Promise<number> {
  return (await PDFDocument.load(data)).getPageCount()
}

export async function makeImage(
  format: "png" | "jpeg" | "webp" | "gif",
  width = 16,
  height = 16,
): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#c33" } })
    .toFormat(format)
    .toBuffer()
}

export const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>',
)

export function hasGhostscript(): boolean {
  try {
    execFileSync("gs", ["--version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

/** Runs `fn` with env vars set, restoring previous values afterwards. */
export async function withEnv<T>(
  vars: Record<string, string>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
  Object.assign(process.env, vars)
  try {
    return await fn()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

export function fileOf(data: Uint8Array, name: string, type: string): File {
  return new File([Buffer.from(data)], name, { type })
}

export function multipartRequest(
  url: string,
  fields: Record<string, string | File | File[]>,
  headers: Record<string, string> = {},
): Request {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) form.append(key, item)
  }
  return new Request(url, { method: "POST", body: form, headers })
}

export async function errorCode(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { error?: { code?: string } }
  return body.error?.code
}
