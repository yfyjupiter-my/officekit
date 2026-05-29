export type ImageOutputFormat = "png" | "jpg" | "webp"

export type ImageConvertInput = {
  name: string
  data: Uint8Array
}

export type ImageConvertOptions =
  | {
      outputFormat: "png"
      pngCompressionLevel?: number
    }
  | {
      outputFormat: "jpg"
      quality?: number
    }
  | {
      outputFormat: "webp"
      quality?: number
    }
