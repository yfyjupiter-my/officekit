import { beforeEach, describe, expect, it, vi } from "vitest"

import { withEnv } from "./helpers"

// The limiter keeps module-level state; load a fresh copy per test.
async function load() {
  vi.resetModules()
  return import("@/lib/rate-limit")
}

function req(ip: string): Request {
  return new Request("http://x/", { headers: { "x-forwarded-for": ip } })
}

describe("checkRateLimit", () => {
  beforeEach(() => vi.useRealTimers())

  it("limits each client independently and sets Retry-After", async () => {
    await withEnv({ RATE_LIMIT_MAX: "2", RATE_LIMIT_GLOBAL_MAX: "100" }, async () => {
      const { checkRateLimit } = await load()
      expect(checkRateLimit(req("1.1.1.1"))).toBeNull()
      expect(checkRateLimit(req("1.1.1.1"))).toBeNull()
      const limited = checkRateLimit(req("1.1.1.1"))
      expect(limited?.status).toBe(429)
      expect(Number(limited?.headers.get("retry-after"))).toBeGreaterThan(0)
      expect(checkRateLimit(req("2.2.2.2"))).toBeNull()
    })
  })

  it("enforces the global limit across clients", async () => {
    await withEnv({ RATE_LIMIT_MAX: "100", RATE_LIMIT_GLOBAL_MAX: "3" }, async () => {
      const { checkRateLimit } = await load()
      for (let i = 0; i < 3; i += 1) expect(checkRateLimit(req(`10.0.0.${i}`))).toBeNull()
      expect(checkRateLimit(req("10.0.0.99"))?.status).toBe(429)
    })
  })

  it("resets after the window", async () => {
    vi.useFakeTimers()
    await withEnv({ RATE_LIMIT_MAX: "1", RATE_LIMIT_WINDOW_MS: "1000" }, async () => {
      const { checkRateLimit } = await load()
      expect(checkRateLimit(req("3.3.3.3"))).toBeNull()
      expect(checkRateLimit(req("3.3.3.3"))?.status).toBe(429)
      vi.advanceTimersByTime(1001)
      expect(checkRateLimit(req("3.3.3.3"))).toBeNull()
    })
  })
})

describe("acquireJobSlot", () => {
  it("queues up to the limit and rejects overflow with 503", async () => {
    await withEnv({ MAX_CONCURRENT_JOBS: "1", MAX_QUEUED_JOBS: "1" }, async () => {
      const { acquireJobSlot } = await load()

      const first = await acquireJobSlot()
      expect(typeof first).toBe("function")

      let secondAcquired = false
      const secondPromise = acquireJobSlot().then((slot) => {
        secondAcquired = true
        return slot
      })
      await Promise.resolve()
      expect(secondAcquired).toBe(false)

      const third = await acquireJobSlot()
      expect((third as Response).status).toBe(503)

      ;(first as () => void)()
      const second = await secondPromise
      expect(typeof second).toBe("function")

      // Double release must not free an extra slot.
      ;(second as () => void)()
      ;(second as () => void)()
      const a = await acquireJobSlot()
      expect(typeof a).toBe("function")
      const b = acquireJobSlot()
      const c = await acquireJobSlot()
      expect((c as Response).status).toBe(503)
      ;(a as () => void)()
      ;((await b) as () => void)()
    })
  })
})
