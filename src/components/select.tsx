"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { Check, ChevronDown } from "lucide-react"

export type SelectOption<T extends string> = {
  value: T
  label: string
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  disabled = false,
  id,
}: {
  value: T
  onChange: (value: T) => void
  options: SelectOption<T>[]
  disabled?: boolean
  id?: string
}) {
  const autoId = useId()
  const selectId = id ?? autoId
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)

  const selected = useMemo(
    () => options.find((opt) => opt.value === value)?.label ?? "",
    [options, value],
  )

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      const root = rootRef.current
      if (!root) return
      if (event.target instanceof Node && root.contains(event.target)) return
      setOpen(false)
    }
    window.addEventListener("pointerdown", onPointerDown)
    return () => window.removeEventListener("pointerdown", onPointerDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        id={selectId}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (disabled ? null : setOpen((v) => !v))}
        className="flex w-full items-center justify-between gap-3 rounded border border-muji-border bg-muji-bg-card px-4 py-2.5 text-sm text-muji-text-primary transition-colors duration-150 focus:border-muji-accent focus:outline-none disabled:opacity-40"
      >
        <span className="truncate">{selected}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muji-text-muted" strokeWidth={1.5} />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-labelledby={selectId}
          className="absolute left-0 right-0 top-full z-10 mt-2 rounded-lg border border-muji-border bg-muji-bg-card shadow-muji-md"
        >
          {options.map((opt) => {
            const isSelected = opt.value === value
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-muji-text-primary transition-colors duration-150 hover:bg-muji-bg-hover"
              >
                <span className={isSelected ? "text-muji-accent" : undefined}>
                  {opt.label}
                </span>
                {isSelected ? (
                  <Check className="h-4 w-4 text-muji-accent" strokeWidth={1.5} />
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
