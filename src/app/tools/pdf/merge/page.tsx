"use client"

import { useId, useMemo, useState } from "react"
import { FileText } from "lucide-react"

import { DownloadButton } from "@/components/download-button"
import { DropZone } from "@/components/dropzone"
import { ConfirmModal } from "@/components/confirm-modal"
import { ErrorState } from "@/components/error-state"
import { FileItem } from "@/components/file-item"
import { Spinner } from "@/components/spinner"
import { ToolPageHeader } from "@/components/tool-page-header"
import { useToast } from "@/components/toast"

type ApiErrorShape = {
  ok: false
  error: {
    code: string
    message: string
    inputIndex?: number
  }
}

type SelectedFile = {
  id: string
  file: File
}

function formatBytes(bytes: number): string {
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

function isProbablyPdf(file: File): boolean {
  const nameLower = file.name.toLowerCase()
  if (nameLower.endsWith(".pdf")) return true
  return file.type === "" || file.type === "application/pdf"
}

function parseAttachmentFilename(contentDisposition: string | null): string | null {
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

export default function PdfMergePage() {
  const inputId = useId()
  const [files, setFiles] = useState<SelectedFile[]>([])
  const [isMerging, setIsMerging] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [result, setResult] = useState<{ blob: Blob; filename: string } | null>(null)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const { push } = useToast()

  const canMerge = useMemo(() => files.length >= 2 && !isMerging, [files, isMerging])

  function addFiles(next: FileList) {
    if (next.length === 0) return

    const additions: SelectedFile[] = []
    const rejected: string[] = []

    for (const file of Array.from(next)) {
      if (!isProbablyPdf(file)) {
        rejected.push(file.name)
        continue
      }
      additions.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}-${file.name}`,
        file,
      })
    }

    setFiles((current) => [...current, ...additions])
    setResult(null)
    setErrorMessage(
      rejected.length > 0
        ? `Only PDF files are supported. Skipped: ${rejected.join(", ")}`
        : null,
    )
  }

  function moveFile(index: number, delta: number) {
    setResult(null)
    setFiles((current) => {
      const next = [...current]
      const targetIndex = index + delta
      if (targetIndex < 0 || targetIndex >= next.length) return current
      const [item] = next.splice(index, 1)
      next.splice(targetIndex, 0, item)
      return next
    })
  }

  function removeFile(id: string) {
    setFiles((current) => current.filter((item) => item.id !== id))
    setResult(null)
  }

  async function downloadBlob(blob: Blob, filename: string): Promise<void> {
    const url = URL.createObjectURL(blob)
    try {
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  async function downloadResult() {
    if (!result) return
    await downloadBlob(result.blob, result.filename)
    push({ kind: "success", title: "Downloaded", description: result.filename })
  }

  async function mergeNow() {
    if (files.length < 2) {
      setErrorMessage("Add at least two PDFs to merge.")
      return
    }

    setIsMerging(true)
    setErrorMessage(null)

    try {
      const form = new FormData()
      for (const item of files) {
        form.append("files[]", item.file)
      }

      const response = await fetch("/api/pdf/merge", {
        method: "POST",
        body: form,
      })

      if (!response.ok) {
        const contentType = response.headers.get("content-type") ?? ""
        if (contentType.includes("application/json")) {
          const payload = (await response.json()) as ApiErrorShape | unknown
          if (
            typeof payload === "object" &&
            payload !== null &&
            "ok" in payload &&
            (payload as ApiErrorShape).ok === false
          ) {
            const typed = payload as ApiErrorShape
            const indexHint =
              typeof typed.error.inputIndex === "number"
                ? ` (file #${typed.error.inputIndex + 1})`
                : ""
            setErrorMessage(`${typed.error.message}${indexHint}`)
            return
          }
        }

        setErrorMessage(`Merge failed (HTTP ${response.status}).`)
        return
      }

      const blob = await response.blob()
      const filename =
        parseAttachmentFilename(response.headers.get("content-disposition")) ??
        "merged.pdf"
      setResult({ blob, filename })
      push({ kind: "success", title: "Ready to download", description: filename })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Merge failed.")
    } finally {
      setIsMerging(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16 space-y-16">
      <ToolPageHeader
        title="PDF Merge"
        description="Upload PDFs, reorder them, then merge into one file."
      />

      <section>
        <div className="rounded-lg border border-muji-border bg-muji-bg-card p-6 shadow-muji-sm">
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-normal text-muji-text-primary">Upload PDFs</p>
              <p className="mt-1 text-xs leading-loose text-muji-text-secondary">
                The order here is the merge order. Add at least two files.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmClearOpen(true)}
              disabled={isMerging || files.length === 0}
              className="rounded border border-muji-border px-3 py-1.5 text-sm text-muji-text-primary transition-colors duration-150 hover:bg-muji-bg-hover disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Clear
            </button>
          </div>

          <div className="mt-4">
            <DropZone
              inputId={inputId}
              accept="application/pdf"
              multiple
              disabled={isMerging}
              hasFiles={files.length > 0}
              onPickFiles={addFiles}
            />
          </div>

          {errorMessage ? (
            <div className="mt-4">
              <ErrorState title="Error" description={errorMessage} />
            </div>
          ) : null}

          <div className="mt-6">
            <p className="text-sm text-muji-text-secondary">
              Files: <span className="text-muji-text-primary">{files.length}</span>
            </p>

            {files.length === 0 ? (
              <div className="mt-3 flex flex-col items-center justify-center rounded border border-muji-border bg-muji-bg-card px-4 py-10 text-center">
                <FileText className="h-8 w-8 text-muji-text-muted" strokeWidth={1.5} />
                <p className="mt-3 text-sm font-normal text-muji-text-secondary">
                  No files yet
                </p>
                <p className="mt-1 text-xs leading-loose text-muji-text-muted">
                  Add PDFs to start.
                </p>
              </div>
            ) : (
              <ol className="mt-3 space-y-2">
                {files.map((item, index) => (
                  <li key={item.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="flex-1">
                      <FileItem
                        name={`${index + 1}. ${item.file.name}`}
                        meta={formatBytes(item.file.size)}
                        onRemove={() => removeFile(item.id)}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => moveFile(index, -1)}
                        disabled={isMerging || index === 0}
                        className="rounded border border-muji-border px-3 py-1.5 text-sm text-muji-text-primary transition-colors duration-150 hover:bg-muji-bg-hover disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        onClick={() => moveFile(index, 1)}
                        disabled={isMerging || index === files.length - 1}
                        className="rounded border border-muji-border px-3 py-1.5 text-sm text-muji-text-primary transition-colors duration-150 hover:bg-muji-bg-hover disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Down
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="my-8 h-px w-full bg-muji-border" />

          {result ? (
            <DownloadButton
              label="Download PDF"
              meta={`${formatBytes(result.blob.size)} · PDF`}
              onClick={downloadResult}
            />
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-loose text-muji-text-secondary">
                Merge files on the server, then download the result.
              </p>
              <button
                type="button"
                onClick={mergeNow}
                disabled={!canMerge}
                className={`flex items-center justify-center gap-2 rounded bg-muji-accent px-6 py-2.5 text-sm font-normal text-muji-text-inverse transition-colors duration-150 hover:bg-muji-accent-hover ${
                  isMerging ? "opacity-60 cursor-not-allowed" : "disabled:opacity-40 disabled:cursor-not-allowed"
                }`}
              >
                {isMerging ? <Spinner size="sm" /> : null}
                {isMerging ? "Processing…" : "Merge"}
              </button>
            </div>
          )}
        </div>
      </section>
      <ConfirmModal
        open={confirmClearOpen}
        title="Clear files?"
        description="This removes all selected PDFs from the list."
        confirmLabel="Clear"
        confirmVariant="danger"
        onClose={() => setConfirmClearOpen(false)}
        onConfirm={() => {
          setFiles([])
          setResult(null)
          setConfirmClearOpen(false)
        }}
      />
    </main>
  )
}
