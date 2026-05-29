type ProgressBarProps = {
  value: number
  label: string
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function ProgressBar({ value, label }: ProgressBarProps) {
  const clamped = clamp01(value)
  const percent = Math.round(clamped * 100)
  return (
    <div className="w-full">
      <div className="h-1 w-full rounded-full bg-muji-bg-hover">
        <div
          className="h-1 rounded-full bg-muji-accent transition-all duration-200 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-2 text-right text-xs leading-loose text-muji-text-muted">
        {label}
      </p>
    </div>
  )
}
