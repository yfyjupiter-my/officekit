"use client"

import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"

type ConfirmModalProps = {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  confirmVariant?: "primary" | "danger"
  cancelLabel?: string
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  confirmVariant = "primary",
  cancelLabel = "Cancel",
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onClose])

  const confirmClass = useMemo(() => {
    if (confirmVariant === "danger") {
      return "rounded border border-muji-error px-6 py-2.5 text-sm text-muji-error transition-colors duration-150 hover:bg-muji-error/10"
    }
    return "rounded bg-muji-accent px-6 py-2.5 text-sm font-normal text-muji-text-inverse transition-colors duration-150 hover:bg-muji-accent-hover"
  }, [confirmVariant])

  if (!mounted || !open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        className="absolute inset-0 bg-muji-overlay"
        onClick={onClose}
        aria-label="Close"
      />
      <div className="relative w-full max-w-sm animate-muji-scale rounded-xl border border-muji-border bg-muji-bg-card p-8 shadow-muji-lg">
        <h2 className="text-lg text-muji-text-primary">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muji-text-secondary">
          {description}
        </p>
        <div className="mt-8 flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-muji-border px-6 py-2.5 text-sm text-muji-text-primary transition-colors duration-150 hover:bg-muji-bg-hover"
          >
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} className={confirmClass}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
