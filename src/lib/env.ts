export function getEnvString(name: string, fallback: string): string {
  const value = process.env[name]
  if (typeof value !== "string") return fallback

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

export function getEnvInt(name: string, fallback: number): number {
  const value = process.env[name]
  if (typeof value !== "string") return fallback

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.trunc(parsed)
}
