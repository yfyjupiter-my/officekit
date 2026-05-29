export type QrCodeErrorCode =
  | "EMPTY_PAYLOAD"
  | "INVALID_PAYLOAD"
  | "INVALID_OPTION"
  | "GENERATE_FAILED"

export type QrCodeErrorField =
  | "text"
  | "wifi.ssid"
  | "wifi.security"
  | "wifi.password"
  | "wifi.hidden"
  | "options.errorCorrectionLevel"
  | "options.width"
  | "options.margin"
  | "options.foregroundColor"
  | "options.backgroundColor"

export class QrCodeError extends Error {
  readonly code: QrCodeErrorCode
  readonly field?: QrCodeErrorField
  readonly details?: string

  constructor(
    code: QrCodeErrorCode,
    message: string,
    options?: { field?: QrCodeErrorField; details?: string },
  ) {
    super(message)
    this.code = code
    this.field = options?.field
    this.details = options?.details
  }
}
