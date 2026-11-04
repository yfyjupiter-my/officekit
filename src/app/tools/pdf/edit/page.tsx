"use client"

import { useId, useMemo, useState } from "react"

import { FileText } from "lucide-react"

import { downloadBlob, formatBytes, isProbablyPdf, parseAttachmentFilename } from "@/lib/client-files"
import { Radio } from "@/components/choice"
import { DropZone } from "@/components/dropzone"
import { ErrorState } from "@/components/error-state"
import { FileItem } from "@/components/file-item"
import { Select } from "@/components/select"
import { Spinner } from "@/components/spinner"
import { ToolPageHeader } from "@/components/tool-page-header"
import { useToast } from "@/components/toast"
import type {
  PdfEditOverlayOptions,
  PdfEditOverlayPositionPreset,
  PdfEditPageSelection,
} from "@/modules/pdf/lib"

type ApiErrorShape = {
  ok: false
  error: {
    code: string
    message: string
    field?: string
  }
}

type PageSelectionMode = PdfEditPageSelection["kind"]

const POSITION_OPTIONS: { value: PdfEditOverlayPositionPreset; label: string }[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
  { value: "center", label: "Center" },
]

export default function PdfEditPage() {
  const inputId = useId()
  const { push } = useToast()

  const [file, setFile] = useState<File | null>(null)
  const [overlayText, setOverlayText] = useState("")
  const [pageMode, setPageMode] = useState<PageSelectionMode>("all")
  const [pageRange, setPageRange] = useState("")
  const [position, setPosition] = useState<PdfEditOverlayPositionPreset>("bottom-right")
  const [fontSize, setFontSize] = useState<number>(24)
  const [opacity, setOpacity] = useState<number>(0.85)

  const [isEditing, setIsEditing] = useState(false)
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

  const canEdit = useMemo(() => {
    if (!file) return false
    if (isEditing) return false
    if (overlayText.trim().length === 0) return false
    if (!Number.isFinite(fontSize) || fontSize < 4 || fontSize > 200) return false
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) return false
    if (pageMode === "range" && pageRange.trim().length === 0) return false
    return true
  }, [file, isEditing, overlayText, fontSize, opacity, pageMode, pageRange])

  function toOptions(): PdfEditOverlayOptions {
    const pages: PdfEditPageSelection =
      pageMode === "all" ? { kind: "all" } : { kind: "range", range: pageRange }

    return {
      text: overlayText,
      fontSize,
      opacity,
      position,
      pages,
    }
  }

  async function editNow() {
    if (!file) {
      setErrorMessage("Select a PDF to edit.")
      return
    }
    if (overlayText.trim().length === 0) {
      setErrorMessage("Overlay text must not be empty.")
      return
    }
    if (pageMode === "range" && pageRange.trim().length === 0) {
      setErrorMessage("Enter a page range (e.g. 1-3,5).")
      return
    }
    if (!Number.isFinite(fontSize) || fontSize < 4 || fontSize > 200) {
      setErrorMessage("Font size must be between 4 and 200.")
      return
    }
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      setErrorMessage("Opacity must be between 0 and 1.")
      return
    }

    setIsEditing(true)
    setErrorMessage(null)

    try {
      const form = new FormData()
      form.append("file", file)
      form.append("options", JSON.stringify(toOptions()))

      const response = await fetch("/api/pdf/edit", {
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
            setErrorMessage(`${typed.error.message}${fieldHint}`)
            return
          }
        }

        setErrorMessage(`Edit failed (HTTP ${response.status}).`)
        return
      }

      const blob = await response.blob()
      const filename =
        parseAttachmentFilename(response.headers.get("content-disposition")) ??
        "edited.pdf"
      downloadBlob(blob, filename)
      push({ kind: "success", title: "Downloaded", description: filename })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Edit failed.")
    } finally {
      setIsEditing(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16 space-y-16">
      <ToolPageHeader
        title="PDF Edit"
        description="Upload a PDF, add a text overlay, then download the edited file."
      />

      <section>
        <div className="rounded-lg border border-muji-border bg-muji-bg-card p-6 shadow-muji-sm">
          <div className="min-w-0">
            <p className="text-sm font-normal text-muji-text-primary">Upload PDF</p>
            <p className="mt-1 text-xs leading-loose text-muji-text-secondary">
              Choose one file. The server will return an edited PDF.
            </p>
          </div>

          <div className="mt-4">
            <DropZone
              inputId={inputId}
              accept="application/pdf"
              multiple={false}
              disabled={isEditing}
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
            ) : (
              <div className="flex flex-col items-center justify-center rounded border border-muji-border bg-muji-bg-card px-4 py-10 text-center">
                <FileText className="h-8 w-8 text-muji-text-muted" strokeWidth={1.5} />
                <p className="mt-3 text-sm font-normal text-muji-text-secondary">
                  No file selected
                </p>
                <p className="mt-1 text-xs leading-loose text-muji-text-muted">
                  Add a PDF to start.
                </p>
              </div>
            )}
          </div>

          <div className="my-8 h-px w-full bg-muji-border" />

          <div className="grid grid-cols-1 gap-6">
            <div>
              <label className="text-sm text-muji-text-primary" htmlFor="overlay-text">
                Overlay text
              </label>
              <textarea
                id="overlay-text"
                value={overlayText}
                onChange={(event) => setOverlayText(event.currentTarget.value)}
                disabled={isEditing}
                placeholder="Enter text to place on the PDF"
                rows={3}
                className="mt-2 w-full resize-none rounded border border-muji-border bg-muji-bg-card px-4 py-2.5 text-sm text-muji-text-primary placeholder:text-muji-text-muted transition-colors duration-150 focus:border-muji-accent focus:outline-none disabled:opacity-40"
              />
              <p className="mt-1 text-xs leading-loose text-muji-text-secondary">
                The overlay is applied as black text with your chosen opacity.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <p className="text-sm text-muji-text-primary">Pages</p>
                <div className="mt-2 flex flex-col gap-2">
                  <Radio
                    name="page-selection"
                    checked={pageMode === "all"}
                    onChange={() => setPageMode("all")}
                    label="All pages"
                    disabled={isEditing}
                  />
                  <Radio
                    name="page-selection"
                    checked={pageMode === "range"}
                    onChange={() => setPageMode("range")}
                    label="Range"
                    disabled={isEditing}
                  />
                </div>
                {pageMode === "range" ? (
                  <div className="mt-3">
                    <label
                      className="text-xs leading-loose text-muji-text-secondary"
                      htmlFor="page-range"
                    >
                      Range string (e.g. 1-3,5)
                    </label>
                    <input
                      id="page-range"
                      type="text"
                      value={pageRange}
                      onChange={(event) => setPageRange(event.currentTarget.value)}
                      disabled={isEditing}
                      placeholder="1-3,5"
                      className="mt-2 w-full rounded border border-muji-border bg-muji-bg-card px-4 py-2.5 text-sm text-muji-text-primary placeholder:text-muji-text-muted transition-colors duration-150 focus:border-muji-accent focus:outline-none disabled:opacity-40"
                    />
                  </div>
                ) : null}
              </div>

              <div>
                <label className="text-sm text-muji-text-primary" htmlFor="position-select">
                  Position
                </label>
                <div className="mt-2">
                  <Select<PdfEditOverlayPositionPreset>
                    id="position-select"
                    value={position}
                    onChange={setPosition}
                    options={POSITION_OPTIONS}
                    disabled={isEditing}
                  />
                </div>
                <p className="mt-1 text-xs leading-loose text-muji-text-secondary">
                  Uses a fixed margin from edges for corner positions.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <label className="text-sm text-muji-text-primary" htmlFor="font-size">
                  Font size
                </label>
                <input
                  id="font-size"
                  type="number"
                  min={4}
                  max={200}
                  step={1}
                  value={fontSize}
                  disabled={isEditing}
                  onChange={(event) => {
                    const next = Number(event.currentTarget.value)
                    setFontSize(Number.isFinite(next) ? next : 24)
                  }}
                  className="mt-2 w-full rounded border border-muji-border bg-muji-bg-card px-4 py-2.5 text-sm text-muji-text-primary transition-colors duration-150 focus:border-muji-accent focus:outline-none disabled:opacity-40"
                />
              </div>

              <div>
                <label className="text-sm text-muji-text-primary" htmlFor="opacity">
                  Opacity (0..1)
                </label>
                <input
                  id="opacity"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={opacity}
                  disabled={isEditing}
                  onChange={(event) => {
                    const next = Number(event.currentTarget.value)
                    setOpacity(Number.isFinite(next) ? next : 0.85)
                  }}
                  className="mt-2 w-full rounded border border-muji-border bg-muji-bg-card px-4 py-2.5 text-sm text-muji-text-primary transition-colors duration-150 focus:border-muji-accent focus:outline-none disabled:opacity-40"
                />
              </div>
            </div>
          </div>

          {errorMessage ? (
            <div className="mt-6">
              <ErrorState title="Error" description={errorMessage} />
            </div>
          ) : null}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-loose text-muji-text-secondary">
              Processing happens on the server. Your browser will download the edited PDF.
            </p>
            <button
              type="button"
              onClick={editNow}
              disabled={!canEdit}
              className={`flex items-center justify-center gap-2 rounded bg-muji-accent px-6 py-2.5 text-sm font-normal text-muji-text-inverse transition-colors duration-150 hover:bg-muji-accent-hover ${
                isEditing ? "opacity-60 cursor-not-allowed" : "disabled:opacity-40 disabled:cursor-not-allowed"
              }`}
            >
              {isEditing ? <Spinner size="sm" /> : null}
              {isEditing ? "Processing…" : "Edit & Download"}
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}
