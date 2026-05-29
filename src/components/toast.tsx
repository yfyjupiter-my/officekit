"use client"

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react"
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Info,
  X as XIcon,
} from "lucide-react"

type ToastKind = "success" | "error" | "info" | "warning"

type ToastItem = {
  id: string
  kind: ToastKind
  title: string
  description?: string
  leaving: boolean
}

type ToastInput = Omit<ToastItem, "id" | "leaving">

type ToastApi = {
  push: (toast: ToastInput) => void
}

const ToastContext = createContext<ToastApi | null>(null)

function iconFor(kind: ToastKind) {
  if (kind === "success") return CheckCircle
  if (kind === "error") return AlertCircle
  if (kind === "warning") return AlertTriangle
  return Info
}

function iconClassFor(kind: ToastKind) {
  if (kind === "success") return "text-muji-success"
  if (kind === "error") return "text-muji-error"
  if (kind === "warning") return "text-muji-warning"
  return "text-muji-info"
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const timeouts = useRef(new Map<string, number>())

  const remove = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id))
    const timeoutId = timeouts.current.get(id)
    if (timeoutId) {
      window.clearTimeout(timeoutId)
      timeouts.current.delete(id)
    }
  }, [])

  const dismiss = useCallback(
    (id: string) => {
      setItems((current) =>
        current.map((item) => (item.id === id ? { ...item, leaving: true } : item)),
      )
      window.setTimeout(() => remove(id), 200)
    },
    [remove],
  )

  const push = useCallback(
    (toast: ToastInput) => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
      setItems((current) => [{ id, leaving: false, ...toast }, ...current])
      const timeoutId = window.setTimeout(() => dismiss(id), 3000)
      timeouts.current.set(id, timeoutId)
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(() => ({ push }), [push])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed bottom-6 right-6 z-50 flex w-full flex-col gap-2 sm:w-72">
        {items.map((toast) => {
          const Icon = iconFor(toast.kind)
          return (
            <div
              key={toast.id}
              className={`rounded-lg border border-muji-border bg-muji-bg-card px-4 py-3 shadow-muji-md transition-opacity duration-200 ${
                toast.leaving ? "opacity-0" : "animate-muji-fade"
              }`}
            >
              <div className="flex items-start gap-3">
                <Icon
                  className={`${iconClassFor(toast.kind)} mt-0.5 h-4 w-4 shrink-0`}
                  strokeWidth={1.5}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-muji-text-primary">{toast.title}</p>
                  {toast.description ? (
                    <p className="mt-0.5 text-xs leading-loose text-muji-text-muted">
                      {toast.description}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  className="text-muji-text-muted transition-colors duration-150 hover:text-muji-text-primary"
                  aria-label="Dismiss"
                >
                  <XIcon className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider")
  }
  return ctx
}
