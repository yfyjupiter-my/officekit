"use client"

import { useId, useState } from "react"

import { DropZone } from "@/components/dropzone"
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

export default function PdfSplitPage() {
  const inputId = useId()
  const { push } = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [isSplitting, setIsSplitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  function onPickFile(next: FileList) {
    const picked = next[0]
    if (!picked) return

    if (!isProbablyPdf(picked)) {
      setFile(null)
      setErrorMessage("Only PDF files are supported.")
      return
    }

    setFile(picked)
    setErrorMessage(null)
  }

  async function splitNow() {
    if (!file) {
      setErrorMessage("Select a PDF to split.")
      return
    }

    setIsSplitting(true)
    setErrorMessage(null)

    try {
      const form = new FormData()
      form.append("file", file)

      const response = await fetch("/api/pdf/split", {
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
            setErrorMessage(typed.error.message)
            return
          }
        }

        setErrorMessage(`Split failed (HTTP ${response.status}).`)
        return
      }

      const blob = await response.blob()
      const filename =
        parseAttachmentFilename(response.headers.get("content-disposition")) ??
        "split.zip"

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
      push({ kind: "success", title: "Downloaded", description: filename })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Split failed.")
    } finally {
      setIsSplitting(false)
    }
  }

  const canSplit = Boolean(file) && !isSplitting

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16 space-y-16">
      <ToolPageHeader
        title="PDF Split"
        description="Upload one PDF, split into per-page PDFs, download as a .zip."
      />

      <section>
        <div className="rounded-lg border border-muji-border bg-muji-bg-card p-6 shadow-muji-sm">
          <div className="min-w-0">
            <p className="text-sm font-normal text-muji-text-primary">Upload PDF</p>
            <p className="mt-1 text-xs leading-loose text-muji-text-secondary">
              Choose one file. The result will be a zip of per-page PDFs.
            </p>
          </div>

          <div className="mt-4">
            <DropZone
              inputId={inputId}
              accept="application/pdf"
              multiple={false}
              disabled={isSplitting}
              hasFiles={Boolean(file)}
              onPickFiles={onPickFile}
            />
          </div>

          <div className="mt-6">
            {file ? (
              <FileItem
                name={file.name}
                meta={formatBytes(file.size)}
                onRemove={() => setFile(null)}
              />
            ) : null}
          </div>

          {errorMessage ? (
            <div className="mt-4">
              <ErrorState title="Error" description={errorMessage} />
            </div>
          ) : null}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-loose text-muji-text-secondary">
              Your browser will download a zip after processing.
            </p>
            <button
              type="button"
              onClick={splitNow}
              disabled={!canSplit}
              className={`flex items-center justify-center gap-2 rounded bg-muji-accent px-6 py-2.5 text-sm font-normal text-muji-text-inverse transition-colors duration-150 hover:bg-muji-accent-hover ${
                isSplitting ? "opacity-60 cursor-not-allowed" : "disabled:opacity-40 disabled:cursor-not-allowed"
              }`}
            >
              {isSplitting ? <Spinner size="sm" /> : null}
              {isSplitting ? "Processing…" : "Split & Download"}
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}
