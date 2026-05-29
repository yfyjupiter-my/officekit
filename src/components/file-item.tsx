"use client"

import { AlertCircle, CheckCircle, FileText, X as XIcon } from "lucide-react"

export type FileItemStatus = "idle" | "success" | "error"

export function FileItem({
  name,
  meta,
  status = "idle",
  onRemove,
}: {
  name: string
  meta: string
  status?: FileItemStatus
  onRemove?: () => void
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded border bg-muji-bg-card px-4 py-3 ${
        status === "error" ? "border-muji-error/30" : "border-muji-border"
      }`}
    >
      <FileText className="h-4 w-4 shrink-0 text-muji-text-muted" strokeWidth={1.5} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-muji-text-primary">{name}</p>
        <p className="mt-0.5 text-xs leading-loose text-muji-text-muted">{meta}</p>
      </div>
      {status === "success" ? (
        <CheckCircle className="h-4 w-4 text-muji-success" strokeWidth={1.5} />
      ) : status === "error" ? (
        <AlertCircle className="h-4 w-4 text-muji-error" strokeWidth={1.5} />
      ) : onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="text-muji-text-muted transition-colors duration-150 hover:text-muji-error"
          aria-label="Remove file"
        >
          <XIcon className="h-4 w-4" strokeWidth={1.5} />
        </button>
      ) : null}
    </div>
  )
}
