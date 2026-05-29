import Link from "next/link"
import { Menu } from "lucide-react"

export function SiteHeader() {
  return (
    <header className="border-b border-muji-border bg-muji-bg">
      <nav className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
        <Link href="/" className="text-base font-normal text-muji-text-primary">
          Home
        </Link>
        <button
          type="button"
          className="sm:hidden text-muji-text-secondary"
          aria-label="Menu"
        >
          <Menu className="h-6 w-6" strokeWidth={1.5} />
        </button>
      </nav>
    </header>
  )
}
