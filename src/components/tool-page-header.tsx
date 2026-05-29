"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"

type ToolPageHeaderProps = {
  title: string
  description?: string
}

export function ToolPageHeader({ title, description }: ToolPageHeaderProps) {
  return (
    <section className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-light leading-snug font-title">{title}</h1>
        {description ? (
          <p className="mt-3 text-sm leading-relaxed text-muji-text-secondary">
            {description}
          </p>
        ) : null}
      </div>
      <Link
        href="/"
        aria-label="Home"
        className="shrink-0 flex items-center justify-center rounded border border-muji-border px-3 py-1.5 text-sm text-muji-text-primary transition-colors duration-150 hover:bg-muji-bg-hover"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
      </Link>
    </section>
  )
}
