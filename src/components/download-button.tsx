"use client"

import { Download } from "lucide-react"

export function DownloadButton({
  label,
  onClick,
  meta,
}: {
  label: string
  onClick: () => void
  meta?: string
}) {
  return (
    <div className="animate-muji-fade">
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-2 rounded bg-muji-accent px-6 py-2.5 text-sm font-normal text-muji-text-inverse transition-colors duration-150 hover:bg-muji-accent-hover"
      >
        <Download className="h-4 w-4" strokeWidth={1.5} />
        {label}
      </button>
      {meta ? (
        <p className="mt-2 text-xs leading-loose text-muji-text-muted">{meta}</p>
      ) : null}
    </div>
  )
}
