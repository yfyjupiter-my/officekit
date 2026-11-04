"use client"

import { useId, useMemo, useState } from "react"
import { Image as ImageIcon } from "lucide-react"

import { downloadBlob, formatBytes, parseAttachmentFilename } from "@/lib/client-files"
import { ConfirmModal } from "@/components/confirm-modal"
import { DownloadButton } from "@/components/download-button"
import { DropZone } from "@/components/dropzone"
import { ErrorState } from "@/components/error-state"
import { FileItem } from "@/components/file-item"
import { Select, type SelectOption } from "@/components/select"
import { Spinner } from "@/components/spinner"
import { useToast } from "@/components/toast"
import { ToolPageHeader } from "@/components/tool-page-header"

type ApiErrorShape = {
  ok: false
  error: {
    code: string
    message: string
    field?: string
    inputIndex?: number
  }
}

type OutputFormat = "png" | "jpg" | "webp"

type SelectedFile = {
  id: string
  file: File
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

function isProbablyImage(file: File): boolean {
  return (
    file.type === "" ||
    file.type.toLowerCase().startsWith("image/") ||
    isImageName(file.name)
  )
}

const OUTPUT_FORMAT_OPTIONS: SelectOption<OutputFormat>[] = [
  { value: "png", label: "PNG" },
  { value: "jpg", label: "JPG" },
  { value: "webp", label: "WEBP" },
]

export default function ImageConvertToolPage() {
  const inputId = useId()
  const { push } = useToast()

  const [files, setFiles] = useState<SelectedFile[]>([])
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("jpg")
  const [quality, setQuality] = useState(80)
  const [pngCompressionLevel, setPngCompressionLevel] = useState(6)
  const [isConverting, setIsConverting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [result, setResult] = useState<{ blob: Blob; filename: string } | null>(null)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)

  const canConvert = useMemo(() => files.length > 0 && !isConverting, [files, isConverting])

  function addFiles(next: FileList) {
    if (next.length === 0) return

    const additions: SelectedFile[] = []
    const rejected: string[] = []

    for (const file of Array.from(next)) {
      if (!isProbablyImage(file)) {
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
        ? `Only image files are supported. Skipped: ${rejected.join(", ")}`
        : null,
    )
  }

  function removeFile(id: string) {
    setFiles((current) => current.filter((item) => item.id !== id))
    setResult(null)
  }

  async function convertNow() {
    if (files.length === 0) {
      setErrorMessage("Add at least one image to convert.")
      return
    }

    setIsConverting(true)
    setErrorMessage(null)

    try {
      const form = new FormData()
      for (const item of files) {
        form.append("files[]", item.file)
      }
      form.set("outputFormat", outputFormat)
      if (outputFormat === "png") {
        form.set("pngCompressionLevel", String(pngCompressionLevel))
      } else {
        form.set("quality", String(quality))
      }

      const response = await fetch("/api/image/convert", {
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
            const fieldHint = typed.error.field ? ` (${typed.error.field})` : ""
            const indexHint =
              typeof typed.error.inputIndex === "number"
                ? ` (file #${typed.error.inputIndex + 1})`
                : ""
            setErrorMessage(`${typed.error.message}${fieldHint}${indexHint}`)
            return
          }
        }

        setErrorMessage(`Convert failed (HTTP ${response.status}).`)
        return
      }

      const blob = await response.blob()
      const filename =
        parseAttachmentFilename(response.headers.get("content-disposition")) ??
        "converted.zip"

      setResult({ blob, filename })
      downloadBlob(blob, filename)
      push({ kind: "success", title: "Downloaded", description: filename })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Convert failed.")
    } finally {
      setIsConverting(false)
    }
  }

  async function downloadResult() {
    if (!result) return
    downloadBlob(result.blob, result.filename)
    push({ kind: "success", title: "Downloaded", description: result.filename })
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16 space-y-16">
      <ToolPageHeader
        title="Image Convert"
        description="Convert one or more images to PNG, JPG, or WEBP and download a zip."
      />

      <section>
        <div className="rounded-lg border border-muji-border bg-muji-bg-card p-6 shadow-muji-sm">
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-normal text-muji-text-primary">Upload images</p>
              <p className="mt-1 text-xs leading-loose text-muji-text-secondary">
                Add 1+ images. Output files are packaged as a zip download.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmClearOpen(true)}
              disabled={isConverting || files.length === 0}
              className="rounded border border-muji-border px-3 py-1.5 text-sm text-muji-text-primary transition-colors duration-150 hover:bg-muji-bg-hover disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Clear
            </button>
          </div>

          <div className="mt-4">
            <DropZone
              inputId={inputId}
              accept="image/png,image/jpeg,image/webp"
              multiple
              disabled={isConverting}
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
                <ImageIcon className="h-8 w-8 text-muji-text-muted" strokeWidth={1.5} />
                <p className="mt-3 text-sm font-normal text-muji-text-secondary">No files yet</p>
                <p className="mt-1 text-xs leading-loose text-muji-text-muted">
                  Add images to start.
                </p>
              </div>
            ) : (
              <ol className="mt-3 space-y-2">
                {files.map((item, index) => (
                  <li key={item.id}>
                    <FileItem
                      name={`${index + 1}. ${item.file.name}`}
                      meta={`${formatBytes(item.file.size)} · ${
                        item.file.type ? item.file.type : "image"
                      }`}
                      onRemove={isConverting ? undefined : () => removeFile(item.id)}
                    />
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="my-8 h-px w-full bg-muji-border" />

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs leading-loose text-muji-text-secondary">Output format</p>
              <Select
                value={outputFormat}
                onChange={(value) => {
                  setOutputFormat(value)
                  setResult(null)
                }}
                disabled={isConverting}
                options={OUTPUT_FORMAT_OPTIONS}
              />
              <p className="text-xs leading-loose text-muji-text-muted">
                PNG is lossless. JPG/WEBP use a quality setting.
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs leading-loose text-muji-text-secondary">
                {outputFormat === "png" ? "PNG compression" : "Quality"}
              </p>
              {outputFormat === "png" ? (
                <div className="rounded border border-muji-border bg-muji-bg-card px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-muji-text-primary">Level</p>
                    <span className="rounded-sm bg-muji-bg-hover px-2 py-0.5 text-xs font-medium text-muji-text-secondary">
                      {pngCompressionLevel}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={9}
                    step={1}
                    value={pngCompressionLevel}
                    disabled={isConverting}
                    onChange={(event) => {
                      setPngCompressionLevel(event.currentTarget.valueAsNumber)
                      setResult(null)
                    }}
                    className="mt-3 w-full accent-[var(--color-muji-accent)]"
                  />
                  <p className="mt-2 text-xs leading-loose text-muji-text-muted">
                    Higher levels usually reduce size but take longer.
                  </p>
                </div>
              ) : (
                <div className="rounded border border-muji-border bg-muji-bg-card px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-muji-text-primary">Quality</p>
                    <span className="rounded-sm bg-muji-bg-hover px-2 py-0.5 text-xs font-medium text-muji-text-secondary">
                      {quality}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    step={1}
                    value={quality}
                    disabled={isConverting}
                    onChange={(event) => {
                      setQuality(event.currentTarget.valueAsNumber)
                      setResult(null)
                    }}
                    className="mt-3 w-full accent-[var(--color-muji-accent)]"
                  />
                  <p className="mt-2 text-xs leading-loose text-muji-text-muted">
                    Higher values keep more detail but increase size.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="my-8 h-px w-full bg-muji-border" />

          {result ? (
            <DownloadButton
              label="Download zip again"
              meta={`${formatBytes(result.blob.size)} · ZIP`}
              onClick={downloadResult}
            />
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-loose text-muji-text-secondary">
                Convert files on the server, then download the result.
              </p>
              <button
                type="button"
                onClick={convertNow}
                disabled={!canConvert}
                className={`flex items-center justify-center gap-2 rounded bg-muji-accent px-6 py-2.5 text-sm font-normal text-muji-text-inverse transition-colors duration-150 hover:bg-muji-accent-hover ${
                  isConverting
                    ? "opacity-60 cursor-not-allowed"
                    : "disabled:opacity-40 disabled:cursor-not-allowed"
                }`}
              >
                {isConverting ? <Spinner size="sm" /> : null}
                {isConverting ? "Processing…" : "Convert"}
              </button>
            </div>
          )}
        </div>
      </section>

      <ConfirmModal
        open={confirmClearOpen}
        title="Clear files?"
        description="This removes all selected images from the list."
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
