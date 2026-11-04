"use client"

import { useId, useMemo, useState } from "react"

import { downloadBlob, formatBytes, isProbablyPdf, parseAttachmentFilename } from "@/lib/client-files"
import { DropZone } from "@/components/dropzone"
import { ErrorState } from "@/components/error-state"
import { FileItem } from "@/components/file-item"
import { Select } from "@/components/select"
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

const PRESETS = [
  {
    value: "balanced",
    label: "Balanced",
    description: "Good default for most office documents.",
  },
  { value: "screen", label: "Screen", description: "Smallest files for on-screen use." },
  { value: "ebook", label: "eBook", description: "Smaller files with decent readability." },
  { value: "printer", label: "Printer", description: "Higher quality for printing." },
  { value: "prepress", label: "Prepress", description: "Highest quality; larger files." },
] as const

type PdfCompressPreset = (typeof PRESETS)[number]["value"]

export default function PdfCompressPage() {
  const inputId = useId()
  const presetId = useId()
  const { push } = useToast()

  const [file, setFile] = useState<File | null>(null)
  const [preset, setPreset] = useState<PdfCompressPreset>("balanced")
  const [isCompressing, setIsCompressing] = useState(false)
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

  async function compressNow() {
    if (!file) {
      setErrorMessage("Select a PDF to compress.")
      return
    }

    setIsCompressing(true)
    setErrorMessage(null)

    try {
      const form = new FormData()
      form.append("file", file)
      form.append("preset", preset)

      const response = await fetch("/api/pdf/compress", {
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

        setErrorMessage(`Compress failed (HTTP ${response.status}).`)
        return
      }

      const blob = await response.blob()
      const filename =
        parseAttachmentFilename(response.headers.get("content-disposition")) ??
        "compressed.pdf"

      downloadBlob(blob, filename)
      const compressionApplied = response.headers.get("x-compression-applied") !== "false"
      push({
        kind: "success",
        title: "Downloaded",
        description: compressionApplied
          ? filename
          : `${filename} — already optimised, original file returned`,
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Compress failed.")
    } finally {
      setIsCompressing(false)
    }
  }

  const canCompress = Boolean(file) && !isCompressing
  const activePreset = useMemo(
    () => PRESETS.find((item) => item.value === preset) ?? PRESETS[0],
    [preset],
  )

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16 space-y-16">
      <ToolPageHeader
        title="PDF Compress"
        description="Upload one PDF, choose a preset, then download the compressed file."
      />

      <section>
        <div className="rounded-lg border border-muji-border bg-muji-bg-card p-6 shadow-muji-sm">
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-normal text-muji-text-primary">Upload PDF</p>
              <p className="mt-1 text-xs leading-loose text-muji-text-secondary">
                Drop a file here, or click to browse.
              </p>
            </div>
          </div>

          <div className="mt-4">
            <DropZone
              inputId={inputId}
              accept="application/pdf"
              multiple={false}
              disabled={isCompressing}
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

          <div className="my-8 h-px w-full bg-muji-border" />

          <div>
            <label htmlFor={presetId} className="text-sm font-normal text-muji-text-secondary">
              Quality preset
            </label>
            <p className="mt-1 text-xs leading-loose text-muji-text-secondary">
              {activePreset.description}
            </p>
            <div className="mt-3">
              <Select<PdfCompressPreset>
                id={presetId}
                value={preset}
                onChange={setPreset}
                disabled={isCompressing}
                options={PRESETS.map((p) => ({ value: p.value, label: p.label }))}
              />
            </div>
          </div>

          {errorMessage ? (
            <div className="mt-4">
              <ErrorState title="Error" description={errorMessage} />
            </div>
          ) : null}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-loose text-muji-text-secondary">
              Your browser will download the compressed PDF after processing.
            </p>
            <button
              type="button"
              onClick={compressNow}
              disabled={!canCompress}
              className={`flex items-center justify-center gap-2 rounded bg-muji-accent px-6 py-2.5 text-sm font-normal text-muji-text-inverse transition-colors duration-150 hover:bg-muji-accent-hover ${
                isCompressing ? "opacity-60 cursor-not-allowed" : "disabled:opacity-40 disabled:cursor-not-allowed"
              }`}
            >
              {isCompressing ? <Spinner size="sm" /> : null}
              {isCompressing ? "Processing…" : "Compress & Download"}
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}
