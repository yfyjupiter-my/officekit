/** Browser-side helpers shared by the tool pages. */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  )
  const value = bytes / 1024 ** exponent
  const digits = exponent === 0 ? 0 : exponent === 1 ? 1 : 2
  return `${value.toFixed(digits)} ${units[exponent]}`
}

export function isProbablyPdf(file: File): boolean {
  const nameLower = file.name.toLowerCase()
  if (nameLower.endsWith(".pdf")) return true
  return file.type === "" || file.type === "application/pdf"
}

export function parseAttachmentFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null
  const match =
    /filename\*=(?:UTF-8'')?([^;]+)|filename="([^"]+)"|filename=([^;]+)/i.exec(
      contentDisposition,
    )
  const raw = (match?.[1] ?? match?.[2] ?? match?.[3])?.trim()
  if (!raw) return null
  const unquoted = raw.replace(/^"(.*)"$/, "$1")
  try {
    return decodeURIComponent(unquoted)
  } catch {
    return unquoted
  }
}

/** Delay before revoking the object URL, so the browser can start the download. */
const REVOKE_DELAY_MS = 30_000

/**
 * Triggers a browser download of `blob`. The object URL is revoked after a
 * delay: revoking synchronously right after `click()` can cancel the
 * download in some browsers (notably Safari and Firefox).
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.rel = "noopener"
  document.body.appendChild(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
  }
}
