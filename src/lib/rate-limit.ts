import { getEnvInt } from "@/lib/env"

/*
 * In-process abuse protection for the API routes (single-instance deployment).
 *
 * - Per-client fixed-window rate limit, keyed by the first X-Forwarded-For
 *   entry. Next.js only sets that header from the socket address when the
 *   client did not send one, so without a reverse proxy that overwrites it the
 *   key can be spoofed; the global limit and job concurrency cap below still
 *   bound total load in that case.
 * - Global fixed-window rate limit across all clients.
 * - Concurrency cap for CPU/memory-heavy jobs (pdf-lib, Ghostscript, sharp)
 *   with a short wait queue; overflow is rejected with 503.
 */

type Window = { count: number; resetAt: number }

const clientWindows = new Map<string, Window>()
const globalWindow: Window = { count: 0, resetAt: 0 }
const MAX_TRACKED_CLIENTS = 10_000

function positiveEnvInt(name: string, fallback: number): number {
  const value = getEnvInt(name, fallback)
  return value > 0 ? value : fallback
}

function getClientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  const first = forwarded?.split(",")[0]?.trim()
  if (first) return first
  return request.headers.get("x-real-ip")?.trim() || "unknown"
}

function hit(window: Window, now: number, windowMs: number): number {
  if (now >= window.resetAt) {
    window.count = 0
    window.resetAt = now + windowMs
  }
  window.count += 1
  return window.count
}

function pruneClientWindows(now: number): void {
  if (clientWindows.size < MAX_TRACKED_CLIENTS) return
  for (const [key, window] of clientWindows) {
    if (now >= window.resetAt) clientWindows.delete(key)
  }
  // Still full (many active clients): drop oldest entries.
  while (clientWindows.size >= MAX_TRACKED_CLIENTS) {
    const oldest = clientWindows.keys().next().value
    if (oldest === undefined) break
    clientWindows.delete(oldest)
  }
}

function tooManyRequests(retryAfterMs: number): Response {
  return Response.json(
    {
      ok: false,
      error: { code: "RATE_LIMITED", message: "Too many requests. Try again later." },
    },
    {
      status: 429,
      headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) },
    },
  )
}

/**
 * Counts this request against the per-client and global limits.
 * Returns a 429 Response when a limit is exceeded, otherwise null.
 */
export function checkRateLimit(request: Request): Response | null {
  const windowMs = positiveEnvInt("RATE_LIMIT_WINDOW_MS", 60_000)
  const perClientMax = positiveEnvInt("RATE_LIMIT_MAX", 30)
  const globalMax = positiveEnvInt("RATE_LIMIT_GLOBAL_MAX", 300)
  const now = Date.now()

  if (hit(globalWindow, now, windowMs) > globalMax) {
    return tooManyRequests(globalWindow.resetAt - now)
  }

  const key = getClientKey(request)
  let window = clientWindows.get(key)
  if (!window) {
    pruneClientWindows(now)
    window = { count: 0, resetAt: 0 }
    clientWindows.set(key, window)
  }
  if (hit(window, now, windowMs) > perClientMax) {
    return tooManyRequests(window.resetAt - now)
  }

  return null
}

let activeJobs = 0
const waiting: (() => void)[] = []

function serverBusy(): Response {
  return Response.json(
    { ok: false, error: { code: "SERVER_BUSY", message: "Server is busy. Try again shortly." } },
    { status: 503, headers: { "Retry-After": "5" } },
  )
}

/**
 * Waits for a heavy-job slot. Returns a release function, or a 503 Response
 * when all slots are busy and the wait queue is full.
 * Call the release function exactly once (e.g. in `finally`).
 */
export async function acquireJobSlot(): Promise<(() => void) | Response> {
  const maxActive = positiveEnvInt("MAX_CONCURRENT_JOBS", 2)
  const maxQueued = getEnvInt("MAX_QUEUED_JOBS", 8)

  if (activeJobs >= maxActive) {
    if (waiting.length >= Math.max(0, maxQueued)) return serverBusy()
    // Slot is handed over directly by release(), so activeJobs is unchanged.
    await new Promise<void>((resolve) => waiting.push(resolve))
  } else {
    activeJobs += 1
  }

  let released = false
  return () => {
    if (released) return
    released = true
    const next = waiting.shift()
    if (next) next()
    else activeJobs -= 1
  }
}
