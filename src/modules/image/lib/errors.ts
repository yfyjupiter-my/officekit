export type ImageConvertErrorCode =
  | "EMPTY_INPUT"
  | "INVALID_IMAGE"
  | "UNSUPPORTED_FORMAT"
  | "IMAGE_TOO_LARGE"
  | "INVALID_OPTION"
  | "CONVERT_FAILED"

export type ImageConvertErrorField =
  | "inputs"
  | "inputs[].data"
  | "options.outputFormat"
  | "options.quality"
  | "options.pngCompressionLevel"

export class ImageConvertError extends Error {
  readonly code: ImageConvertErrorCode
  readonly field?: ImageConvertErrorField
  readonly inputIndex?: number
  readonly details?: string

  constructor(
    code: ImageConvertErrorCode,
    message: string,
    options?: {
      field?: ImageConvertErrorField
      inputIndex?: number
      details?: string
    },
  ) {
    super(message)
    this.code = code
    this.field = options?.field
    this.inputIndex = options?.inputIndex
    this.details = options?.details
  }
}
