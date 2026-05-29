import QRCode from "qrcode"

import { QrCodeError } from "./errors"
import type { QrCodeErrorField } from "./errors"
import type {
  QrErrorCorrectionLevel,
  QrGenerateOptions,
  QrPayload,
  QrWifiSecurity,
} from "./types"

function requireNonEmptyString(value: string, field: QrCodeErrorField): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new QrCodeError("EMPTY_PAYLOAD", "Value must not be empty.", { field })
  }
  return trimmed
}

function isQrEccLevel(value: string): value is QrErrorCorrectionLevel {
  return value === "L" || value === "M" || value === "Q" || value === "H"
}

function parseEccLevel(level: QrGenerateOptions["errorCorrectionLevel"]): QrErrorCorrectionLevel {
  if (typeof level === "undefined") return "M"
  if (isQrEccLevel(level)) return level
  throw new QrCodeError("INVALID_OPTION", "Invalid error correction level.", {
    field: "options.errorCorrectionLevel",
  })
}

function parseBoundedInt(
  value: number | undefined,
  options: { field: "options.width" | "options.margin"; min: number; max: number; fallback: number },
): number {
  if (typeof value === "undefined") return options.fallback
  if (!Number.isFinite(value)) {
    throw new QrCodeError("INVALID_OPTION", "Invalid number.", { field: options.field })
  }
  const int = Math.trunc(value)
  if (int < options.min || int > options.max) {
    throw new QrCodeError(
      "INVALID_OPTION",
      `Value must be between ${options.min} and ${options.max}.`,
      { field: options.field },
    )
  }
  return int
}

function parseHexColor(
  value: string | undefined,
  field: "options.foregroundColor" | "options.backgroundColor",
  fallback: string,
): string {
  if (typeof value === "undefined") return fallback
  const trimmed = value.trim()
  if (trimmed.length === 0) return fallback
  const match = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(trimmed)
  if (!match) {
    throw new QrCodeError("INVALID_OPTION", "Invalid color. Expected #RRGGBB or #RRGGBBAA.", {
      field,
    })
  }
  return `#${match[1]}${match[2] ?? ""}`
}

function escapeWifiValue(value: string): string {
  return value.replace(/[\\;,:]/g, (character) => `\\${character}`)
}

function assertWifiSecurity(value: string): asserts value is QrWifiSecurity {
  if (value === "WPA" || value === "WEP" || value === "nopass") return
  throw new QrCodeError("INVALID_PAYLOAD", "Invalid Wi-Fi security type.", {
    field: "wifi.security",
  })
}

function toWifiPayloadText(payload: Extract<QrPayload, { type: "wifi" }>): string {
  const ssid = requireNonEmptyString(payload.ssid, "wifi.ssid")
  const securityRaw = payload.security
  assertWifiSecurity(securityRaw)

  const security = securityRaw
  const passwordRaw = payload.password ?? ""
  const password = passwordRaw.trim()

  if (security !== "nopass" && password.length === 0) {
    throw new QrCodeError("INVALID_PAYLOAD", "Wi-Fi password is required for WPA/WEP.", {
      field: "wifi.password",
    })
  }

  const parts: string[] = []
  parts.push(`T:${security}`)
  parts.push(`S:${escapeWifiValue(ssid)}`)
  if (security !== "nopass") {
    parts.push(`P:${escapeWifiValue(password)}`)
  }
  if (payload.hidden === true) {
    parts.push("H:true")
  }

  return `WIFI:${parts.join(";")};;`
}

function toQrText(payload: QrPayload): string {
  if (payload.type === "text") {
    return requireNonEmptyString(payload.text, "text")
  }
  if (payload.type === "wifi") {
    return toWifiPayloadText(payload)
  }
  throw new QrCodeError("INVALID_PAYLOAD", "Unsupported payload type.")
}

export async function generateQrPngBuffer(
  payload: QrPayload,
  options: QrGenerateOptions = {},
): Promise<Buffer> {
  const text = toQrText(payload)

  const errorCorrectionLevel = parseEccLevel(options.errorCorrectionLevel)
  const width = parseBoundedInt(options.width, {
    field: "options.width",
    min: 64,
    max: 2048,
    fallback: 512,
  })
  const margin = parseBoundedInt(options.margin, {
    field: "options.margin",
    min: 0,
    max: 16,
    fallback: 2,
  })

  const dark = parseHexColor(options.foregroundColor, "options.foregroundColor", "#2c2c2c")
  const light = parseHexColor(options.backgroundColor, "options.backgroundColor", "#fdfcfa")

  try {
    const buffer = await QRCode.toBuffer(text, {
      type: "png",
      errorCorrectionLevel,
      width,
      margin,
      color: { dark, light },
    })
    return buffer
  } catch (error) {
    throw new QrCodeError("GENERATE_FAILED", "Failed to generate QR code.", {
      details: error instanceof Error ? error.message : undefined,
    })
  }
}
