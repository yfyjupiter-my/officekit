"use client"

import { AlertCircle } from "lucide-react"

export function ErrorState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-muji-error/30 bg-muji-error/5 px-4 py-3">
      <AlertCircle className="mt-0.5 h-4 w-4 text-muji-error" strokeWidth={1.5} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-muji-error">{title}</p>
        <p className="mt-0.5 text-xs leading-loose text-muji-text-muted">
          {description}
        </p>
      </div>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="text-xs text-muji-text-secondary underline-offset-2 transition-colors duration-150 hover:underline"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}
