import { NextResponse } from "next/server"

import { QrCodeError, generateQrPngBuffer } from "@/modules/qrcode"
import type {
  QrErrorCorrectionLevel,
  QrGenerateOptions,
  QrPayload,
  QrWifiSecurity,
} from "@/modules/qrcode"

export const runtime = "nodejs"

type ApiErrorShape = {
  ok: false
  error: {
    code: string
    message: string
    field?: string
  }
}

function badRequest(code: string, message: string, field?: string): NextResponse<ApiErrorShape> {
  return NextResponse.json({ ok: false, error: { code, message, field } }, { status: 400 })
}

function internalError(): NextResponse<ApiErrorShape> {
  return NextResponse.json(
    { ok: false, error: { code: "INTERNAL_ERROR", message: "Internal error." } },
    { status: 500 },
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isQrWifiSecurity(value: unknown): value is QrWifiSecurity {
  return value === "WPA" || value === "WEP" || value === "nopass"
}

function isQrEccLevel(value: unknown): value is QrErrorCorrectionLevel {
  return value === "L" || value === "M" || value === "Q" || value === "H"
}

function parsePayload(input: unknown): QrPayload {
  if (!isRecord(input)) {
    throw new QrCodeError("INVALID_PAYLOAD", "Invalid payload.", { field: "text" })
  }

  const type = input.type
  if (type === "text") {
    const text = input.text
    if (typeof text !== "string") {
      throw new QrCodeError("INVALID_PAYLOAD", "Text payload must be a string.", {
        field: "text",
      })
    }
    return { type: "text", text }
  }

  if (type === "wifi") {
    const ssid = input.ssid
    if (typeof ssid !== "string") {
      throw new QrCodeError("INVALID_PAYLOAD", "Wi-Fi SSID must be a string.", {
        field: "wifi.ssid",
      })
    }

    const security = input.security
    if (!isQrWifiSecurity(security)) {
      throw new QrCodeError("INVALID_PAYLOAD", "Invalid Wi-Fi security type.", {
        field: "wifi.security",
      })
    }

    const password = input.password
    if (typeof password !== "undefined" && typeof password !== "string") {
      throw new QrCodeError("INVALID_PAYLOAD", "Wi-Fi password must be a string.", {
        field: "wifi.password",
      })
    }

    const hidden = input.hidden
    if (typeof hidden !== "undefined" && typeof hidden !== "boolean") {
      throw new QrCodeError("INVALID_PAYLOAD", "Wi-Fi hidden must be a boolean.", {
        field: "wifi.hidden",
      })
    }

    return {
      type: "wifi",
      ssid,
      security,
      password: typeof password === "string" ? password : undefined,
      hidden: typeof hidden === "boolean" ? hidden : undefined,
    }
  }

  throw new QrCodeError("INVALID_PAYLOAD", "Unsupported payload type.", { field: "text" })
}

function parseOptions(input: unknown): QrGenerateOptions {
  if (typeof input === "undefined") return {}
  if (!isRecord(input)) {
    throw new QrCodeError("INVALID_OPTION", "Options must be an object.", {
      field: "options.width",
    })
  }

  const errorCorrectionLevel = input.errorCorrectionLevel
  if (typeof errorCorrectionLevel !== "undefined" && !isQrEccLevel(errorCorrectionLevel)) {
    throw new QrCodeError("INVALID_OPTION", "Invalid error correction level.", {
      field: "options.errorCorrectionLevel",
    })
  }

  const width = input.width
  if (typeof width !== "undefined" && typeof width !== "number") {
    throw new QrCodeError("INVALID_OPTION", "Width must be a number.", {
      field: "options.width",
    })
  }

  const margin = input.margin
  if (typeof margin !== "undefined" && typeof margin !== "number") {
    throw new QrCodeError("INVALID_OPTION", "Margin must be a number.", {
      field: "options.margin",
    })
  }

  const foregroundColor = input.foregroundColor
  if (typeof foregroundColor !== "undefined" && typeof foregroundColor !== "string") {
    throw new QrCodeError("INVALID_OPTION", "Foreground color must be a string.", {
      field: "options.foregroundColor",
    })
  }

  const backgroundColor = input.backgroundColor
  if (typeof backgroundColor !== "undefined" && typeof backgroundColor !== "string") {
    throw new QrCodeError("INVALID_OPTION", "Background color must be a string.", {
      field: "options.backgroundColor",
    })
  }

  return {
    errorCorrectionLevel: isQrEccLevel(errorCorrectionLevel) ? errorCorrectionLevel : undefined,
    width: typeof width === "number" ? width : undefined,
    margin: typeof margin === "number" ? margin : undefined,
    foregroundColor: typeof foregroundColor === "string" ? foregroundColor : undefined,
    backgroundColor: typeof backgroundColor === "string" ? backgroundColor : undefined,
  }
}

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.toLowerCase().includes("application/json")) {
    return badRequest("INVALID_CONTENT_TYPE", "Expected application/json request body.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return badRequest("INVALID_JSON", "Invalid JSON body.")
  }

  if (!isRecord(body)) {
    return badRequest("INVALID_BODY", "Request body must be a JSON object.")
  }

  try {
    const payload = parsePayload(body.payload)
    const options = parseOptions(body.options)

    const png = await generateQrPngBuffer(payload, options)
    const bytes = new Uint8Array(png)

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": 'attachment; filename="qrcode.png"',
      },
    })
  } catch (error) {
    if (error instanceof QrCodeError) {
      return badRequest(error.code, error.message, error.field)
    }
    return internalError()
  }
}
