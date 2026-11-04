import { getEnvInt } from "@/lib/env"

const DEFAULT_MAX_PDF_PAGES = 500

/**
 * Max pages a PDF tool will process per request (summed across inputs for
 * merge). Bounds memory/CPU: a small file can still declare thousands of
 * pages, and split/merge materialise every page in memory.
 */
export function getMaxPdfPages(): number {
  const value = getEnvInt("MAX_PDF_PAGES", DEFAULT_MAX_PDF_PAGES)
  return value > 0 ? value : DEFAULT_MAX_PDF_PAGES
}
