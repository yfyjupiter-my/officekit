type SpinnerSize = "sm" | "md" | "lg"

const sizeClass: Record<SpinnerSize, string> = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
}

export function Spinner({ size = "sm" }: { size?: SpinnerSize }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block rounded-full border border-muji-border border-t-muji-accent ${sizeClass[size]} animate-muji-spin`}
    />
  )
}
