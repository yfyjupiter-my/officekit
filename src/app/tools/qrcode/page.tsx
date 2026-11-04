"use client"

import { useEffect, useId, useMemo, useState } from "react"

import { downloadBlob, parseAttachmentFilename } from "@/lib/client-files"
import { Checkbox, Radio } from "@/components/choice"
import { ErrorState } from "@/components/error-state"
import { Select } from "@/components/select"
import { Spinner } from "@/components/spinner"
import { ToolPageHeader } from "@/components/tool-page-header"
import { useToast } from "@/components/toast"

type ApiErrorShape = {
  ok: false
  error: {
    code: string
    message: string
    field?: string
  }
}

type Mode = "text" | "wifi"
type WifiSecurity = "WPA" | "WEP" | "nopass"
type EccLevel = "L" | "M" | "Q" | "H"

function readCssVar(name: string): string | null {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value.length > 0 ? value : null
}

function clampNumberText(value: string, options: { min: number; max: number }): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) return ""
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return ""
  const int = Math.trunc(parsed)
  if (int < options.min) return String(options.min)
  if (int > options.max) return String(options.max)
  return String(int)
}

export default function QrCodeToolPage() {
  const modeName = useId()
  const inputId = useId()
  const { push } = useToast()

  const [mode, setMode] = useState<Mode>("text")
  const [text, setText] = useState("")

  const [ssid, setSsid] = useState("")
  const [security, setSecurity] = useState<WifiSecurity>("WPA")
  const [password, setPassword] = useState("")
  const [hidden, setHidden] = useState(false)

  const [errorCorrectionLevel, setErrorCorrectionLevel] = useState<EccLevel>("M")
  const [widthText, setWidthText] = useState("512")
  const [marginText, setMarginText] = useState("2")
  const [foregroundColor, setForegroundColor] = useState("")
  const [backgroundColor, setBackgroundColor] = useState("")

  const [isGenerating, setIsGenerating] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    setForegroundColor((current) => current || readCssVar("--muji-text-primary") || "#2c2c2c")
    setBackgroundColor((current) => current || readCssVar("--muji-bg-card") || "#fdfcfa")
  }, [])

  const canGenerate = useMemo(() => !isGenerating, [isGenerating])

  async function generateNow() {
    setErrorMessage(null)

    const modeTrimmed = mode
    if (modeTrimmed === "text") {
      if (text.trim().length === 0) {
        setErrorMessage("Enter some text or a URL.")
        return
      }
    } else {
      if (ssid.trim().length === 0) {
        setErrorMessage("Wi-Fi SSID is required.")
        return
      }
      if (security !== "nopass" && password.trim().length === 0) {
        setErrorMessage("Wi-Fi password is required for WPA/WEP.")
        return
      }
    }

    const width = Number(widthText.trim())
    const margin = Number(marginText.trim())

    const options: Record<string, unknown> = {
      errorCorrectionLevel,
    }

    if (widthText.trim().length > 0) options.width = width
    if (marginText.trim().length > 0) options.margin = margin
    if (foregroundColor.trim().length > 0) options.foregroundColor = foregroundColor.trim()
    if (backgroundColor.trim().length > 0) options.backgroundColor = backgroundColor.trim()

    const payload: Record<string, unknown> =
      modeTrimmed === "text"
        ? { type: "text", text }
        : {
            type: "wifi",
            ssid,
            security,
            password: security === "nopass" ? undefined : password,
            hidden,
          }

    setIsGenerating(true)
    try {
      const response = await fetch("/api/qrcode/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload, options }),
      })

      if (!response.ok) {
        const contentType = response.headers.get("content-type") ?? ""
        if (contentType.includes("application/json")) {
          const payloadJson = (await response.json()) as ApiErrorShape | unknown
          if (
            typeof payloadJson === "object" &&
            payloadJson !== null &&
            "ok" in payloadJson &&
            (payloadJson as ApiErrorShape).ok === false
          ) {
            const typed = payloadJson as ApiErrorShape
            setErrorMessage(typed.error.message)
            return
          }
        }

        setErrorMessage(`Generate failed (HTTP ${response.status}).`)
        return
      }

      const blob = await response.blob()
      const filename =
        parseAttachmentFilename(response.headers.get("content-disposition")) ?? "qrcode.png"

      downloadBlob(blob, filename)
      push({ kind: "success", title: "Downloaded", description: filename })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Generate failed.")
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16 space-y-16">
      <ToolPageHeader
        title="QR Code Generator"
        description="Generate a QR code as a PNG download."
      />

      <section>
        <div className="rounded-lg border border-muji-border bg-muji-bg-card p-6 shadow-muji-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-normal text-muji-text-primary">Content type</p>
              <p className="mt-1 text-xs leading-loose text-muji-text-secondary">
                Choose Text/URL or Wi-Fi payload.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
              <Radio
                name={modeName}
                checked={mode === "text"}
                onChange={() => setMode("text")}
                label="Text / URL"
                disabled={isGenerating}
              />
              <Radio
                name={modeName}
                checked={mode === "wifi"}
                onChange={() => setMode("wifi")}
                label="Wi-Fi"
                disabled={isGenerating}
              />
            </div>
          </div>

          <div className="mt-6">
            {mode === "text" ? (
              <div>
                <label htmlFor={inputId} className="text-sm font-normal">
                  Text / URL
                </label>
                <p className="mt-1 text-xs leading-loose text-muji-text-secondary">
                  Paste a URL or any text. Empty values are rejected.
                </p>
                <textarea
                  id={inputId}
                  value={text}
                  onChange={(event) => setText(event.currentTarget.value)}
                  rows={4}
                  disabled={isGenerating}
                  className="mt-3 block w-full resize-y rounded border border-muji-border bg-muji-bg-card px-4 py-2.5 text-sm text-muji-text-primary placeholder:text-muji-text-muted transition-colors duration-150 focus:border-muji-accent focus:outline-none disabled:opacity-40"
                  placeholder="https://example.com"
                />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor={inputId} className="text-sm font-normal">
                    SSID
                  </label>
                  <input
                    id={inputId}
                    value={ssid}
                    onChange={(event) => setSsid(event.currentTarget.value)}
                    disabled={isGenerating}
                    className="mt-2 block w-full rounded border border-muji-border bg-muji-bg-card px-4 py-2.5 text-sm text-muji-text-primary placeholder:text-muji-text-muted transition-colors duration-150 focus:border-muji-accent focus:outline-none disabled:opacity-40"
                    placeholder="Office WiFi"
                  />
                </div>

                <div>
                  <label className="text-sm font-normal" htmlFor={`${inputId}-security`}>
                    Security
                  </label>
                  <div className="mt-2">
                    <Select<WifiSecurity>
                      value={security}
                      onChange={(next) => setSecurity(next)}
                      disabled={isGenerating}
                      id={`${inputId}-security`}
                      options={[
                        { value: "WPA", label: "WPA/WPA2" },
                        { value: "WEP", label: "WEP" },
                        { value: "nopass", label: "No password" },
                      ]}
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-normal" htmlFor={`${inputId}-password`}>
                    Password
                  </label>
                  <input
                    id={`${inputId}-password`}
                    value={password}
                    onChange={(event) => setPassword(event.currentTarget.value)}
                    disabled={isGenerating || security === "nopass"}
                    className="mt-2 block w-full rounded border border-muji-border bg-muji-bg-card px-4 py-2.5 text-sm text-muji-text-primary placeholder:text-muji-text-muted transition-colors duration-150 focus:border-muji-accent focus:outline-none disabled:opacity-40"
                    placeholder={security === "nopass" ? "Not required" : "Wi-Fi password"}
                  />
                </div>

                <div className="sm:col-span-2">
                  <Checkbox
                    checked={hidden}
                    onChange={setHidden}
                    label="Hidden network"
                    disabled={isGenerating}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="my-8 h-px bg-muji-border" />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-normal" htmlFor={`${inputId}-ecc`}>
                Error correction
              </label>
              <div className="mt-2">
                <Select<EccLevel>
                  value={errorCorrectionLevel}
                  onChange={(next) => setErrorCorrectionLevel(next)}
                  disabled={isGenerating}
                  id={`${inputId}-ecc`}
                  options={[
                    { value: "L", label: "L (7%)" },
                    { value: "M", label: "M (15%)" },
                    { value: "Q", label: "Q (25%)" },
                    { value: "H", label: "H (30%)" },
                  ]}
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-normal" htmlFor={`${inputId}-size`}>
                Size (px)
              </label>
              <input
                id={`${inputId}-size`}
                inputMode="numeric"
                value={widthText}
                onChange={(event) =>
                  setWidthText(clampNumberText(event.currentTarget.value, { min: 64, max: 2048 }))
                }
                disabled={isGenerating}
                className="mt-2 block w-full rounded border border-muji-border bg-muji-bg-card px-4 py-2.5 text-sm text-muji-text-primary placeholder:text-muji-text-muted transition-colors duration-150 focus:border-muji-accent focus:outline-none disabled:opacity-40"
                placeholder="512"
              />
              <p className="mt-1 text-xs leading-loose text-muji-text-muted">
                Range: 64–2048
              </p>
            </div>

            <div>
              <label className="text-sm font-normal" htmlFor={`${inputId}-margin`}>
                Margin
              </label>
              <input
                id={`${inputId}-margin`}
                inputMode="numeric"
                value={marginText}
                onChange={(event) =>
                  setMarginText(clampNumberText(event.currentTarget.value, { min: 0, max: 16 }))
                }
                disabled={isGenerating}
                className="mt-2 block w-full rounded border border-muji-border bg-muji-bg-card px-4 py-2.5 text-sm text-muji-text-primary placeholder:text-muji-text-muted transition-colors duration-150 focus:border-muji-accent focus:outline-none disabled:opacity-40"
                placeholder="2"
              />
              <p className="mt-1 text-xs leading-loose text-muji-text-muted">Range: 0–16</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
              <div className="sm:col-span-2">
                <p className="text-sm font-normal">Colors</p>
                <p className="mt-1 text-xs leading-loose text-muji-text-secondary">
                  Provide hex colors (#RRGGBB or #RRGGBBAA).
                </p>
              </div>

              <div>
                <label className="text-xs font-medium text-muji-text-muted" htmlFor={`${inputId}-fg`}>
                  Foreground
                </label>
                <input
                  id={`${inputId}-fg`}
                  value={foregroundColor}
                  onChange={(event) => setForegroundColor(event.currentTarget.value)}
                  disabled={isGenerating}
                  className="mt-2 block w-full rounded border border-muji-border bg-muji-bg-card px-4 py-2.5 text-sm text-muji-text-primary placeholder:text-muji-text-muted transition-colors duration-150 focus:border-muji-accent focus:outline-none disabled:opacity-40"
                  placeholder="#2c2c2c"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muji-text-muted" htmlFor={`${inputId}-bg`}>
                  Background
                </label>
                <input
                  id={`${inputId}-bg`}
                  value={backgroundColor}
                  onChange={(event) => setBackgroundColor(event.currentTarget.value)}
                  disabled={isGenerating}
                  className="mt-2 block w-full rounded border border-muji-border bg-muji-bg-card px-4 py-2.5 text-sm text-muji-text-primary placeholder:text-muji-text-muted transition-colors duration-150 focus:border-muji-accent focus:outline-none disabled:opacity-40"
                  placeholder="#fdfcfa"
                />
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              {errorMessage ? (
                <ErrorState title="Error" description={errorMessage} />
              ) : (
                <p className="text-sm text-muji-text-secondary">
                  Click Generate to download a PNG.
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={generateNow}
              disabled={!canGenerate}
              className={`flex items-center justify-center gap-2 rounded bg-muji-accent px-6 py-2.5 text-sm font-normal text-muji-text-inverse transition-colors duration-150 hover:bg-muji-accent-hover ${
                isGenerating ? "opacity-60 cursor-not-allowed" : "disabled:cursor-not-allowed disabled:opacity-40"
              }`}
            >
              {isGenerating ? <Spinner size="sm" /> : null}
              {isGenerating ? "Processing…" : "Generate PNG"}
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}
