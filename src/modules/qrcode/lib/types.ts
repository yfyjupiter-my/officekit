export type QrErrorCorrectionLevel = "L" | "M" | "Q" | "H"

export type QrWifiSecurity = "WPA" | "WEP" | "nopass"

export type QrPayload =
  | {
      type: "text"
      text: string
    }
  | {
      type: "wifi"
      ssid: string
      security: QrWifiSecurity
      password?: string
      hidden?: boolean
    }

export type QrGenerateOptions = {
  errorCorrectionLevel?: QrErrorCorrectionLevel
  width?: number
  margin?: number
  foregroundColor?: string
  backgroundColor?: string
}

