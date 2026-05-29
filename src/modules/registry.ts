export type ToolStatus = "active" | "coming-soon"

export type ToolCategory = "pdf" | "image" | "qr"

export type ToolCategoryTheme = {
  label: string
  textClassName: string
  borderClassName: string
  stripClassName: string
}

export const toolCategoryTheme = {
  pdf: {
    label: "PDF",
    textClassName: "text-muji-accent",
    borderClassName: "border-muji-accent",
    stripClassName: "bg-muji-accent/60",
  },
  image: {
    label: "Image",
    textClassName: "text-muji-success",
    borderClassName: "border-muji-success",
    stripClassName: "bg-muji-success/60",
  },
  qr: {
    label: "QR",
    textClassName: "text-muji-info",
    borderClassName: "border-muji-info",
    stripClassName: "bg-muji-info/60",
  },
} satisfies Record<ToolCategory, ToolCategoryTheme>

export interface ToolMeta {
  name: string
  slug: string
  route: string
  status: ToolStatus
  category: ToolCategory
}

export const toolRegistry: readonly ToolMeta[] = [
  {
    name: "PDF Merge",
    slug: "pdf-merge",
    route: "/tools/pdf/merge",
    status: "active",
    category: "pdf",
  },
  {
    name: "PDF Split",
    slug: "pdf-split",
    route: "/tools/pdf/split",
    status: "active",
    category: "pdf",
  },
  {
    name: "PDF Compress",
    slug: "pdf-compress",
    route: "/tools/pdf/compress",
    status: "active",
    category: "pdf",
  },
  {
    name: "PDF Edit",
    slug: "pdf-edit",
    route: "/tools/pdf/edit",
    status: "active",
    category: "pdf",
  },
  {
    name: "QR Code Generator",
    slug: "qrcode",
    route: "/tools/qrcode",
    status: "active",
    category: "qr",
  },
  {
    name: "Image Convert",
    slug: "image-convert",
    route: "/tools/image/convert",
    status: "active",
    category: "image",
  },
] as const
