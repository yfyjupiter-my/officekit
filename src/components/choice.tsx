"use client"

import { Check } from "lucide-react"

export function Checkbox({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <label
      className={`flex items-center gap-2.5 text-sm ${
        disabled ? "opacity-40" : ""
      }`}
    >
      <span className="relative inline-flex h-4 w-4 items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.checked)}
          className="peer sr-only"
        />
        <span className="h-4 w-4 rounded-sm border border-muji-border bg-muji-bg-card peer-focus:border-muji-accent peer-checked:border-muji-accent peer-checked:bg-muji-accent" />
        <Check
          className="pointer-events-none absolute h-2.5 w-2.5 text-muji-text-inverse opacity-0 peer-checked:opacity-100"
          strokeWidth={1.5}
        />
      </span>
      <span className="text-muji-text-primary">{label}</span>
    </label>
  )
}

export function Radio({
  checked,
  onChange,
  label,
  disabled = false,
  name,
}: {
  checked: boolean
  onChange: () => void
  label: string
  disabled?: boolean
  name: string
}) {
  return (
    <label
      className={`flex items-center gap-2.5 text-sm ${
        disabled ? "opacity-40" : ""
      }`}
    >
      <span className="relative inline-flex h-4 w-4 items-center justify-center">
        <input
          type="radio"
          name={name}
          checked={checked}
          disabled={disabled}
          onChange={onChange}
          className="peer sr-only"
        />
        <span className="h-4 w-4 rounded-full border border-muji-border bg-muji-bg-card peer-focus:border-muji-accent peer-checked:border-muji-accent" />
        <span className="pointer-events-none absolute h-1.5 w-1.5 rounded-full bg-muji-accent opacity-0 peer-checked:opacity-100" />
      </span>
      <span className="text-muji-text-primary">{label}</span>
    </label>
  )
}
