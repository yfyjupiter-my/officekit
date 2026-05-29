export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-muji-border">
      <div className="mx-auto max-w-3xl px-6 py-8 text-xs font-normal text-muji-text-muted">
        © {new Date().getFullYear()}
      </div>
    </footer>
  )
}
