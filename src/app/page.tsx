import Link from "next/link"

import { toolCategoryTheme, toolRegistry } from "@/modules/registry"

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16 space-y-16">
      <section>
        <h1 className="text-2xl font-light leading-snug font-title">
          Simple tools for everyday work.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muji-text-secondary">
          No login required. Files are processed on the server and temporary uploads are
          cleaned up after processing.
        </p>
      </section>

      <section>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {toolRegistry.map((tool) => {
            const category = toolCategoryTheme[tool.category]
            const Card = (
              <div
                className="relative overflow-hidden rounded-lg border border-muji-border bg-muji-bg-card p-6 shadow-muji-sm transition-shadow duration-200 hover:shadow-muji-md"
              >
                <div
                  aria-hidden="true"
                  className={`absolute inset-y-0 left-0 w-2 rounded-l-lg ${category.stripClassName}`}
                />
                <div className="flex items-start justify-between gap-4">
                  <p className="text-base font-normal text-muji-text-primary">
                    {tool.name}
                  </p>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-sm bg-muji-bg-hover px-2 py-0.5 text-xs font-medium ${category.textClassName}`}
                    >
                      {category.label}
                    </span>
                    <span className="rounded-sm bg-muji-bg-hover px-2 py-0.5 text-xs font-medium text-muji-text-secondary">
                      {tool.status}
                    </span>
                  </div>
                </div>
              </div>
            )

            if (tool.status === "active") {
              return (
                <Link key={tool.slug} href={tool.route} className="block">
                  {Card}
                </Link>
              )
            }

            return (
              <div key={tool.slug} className="opacity-40">
                {Card}
              </div>
            )
          })}
        </div>
      </section>
    </main>
  )
}
