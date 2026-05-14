// Authed shell layout — no auth yet (Phase 1 is open access).
// Supabase Auth will be wired in a later task.
import type { ReactNode } from "react";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b px-6 py-3">
        <nav className="flex items-center gap-6 font-medium text-sm">
          <a href="/" className="font-semibold">
            AI Code Reviewer
          </a>
          <a href="/reviews" className="text-muted-foreground hover:text-foreground">
            Reviews
          </a>
          <a href="/repos" className="text-muted-foreground hover:text-foreground">
            Repos
          </a>
          <a href="/settings" className="text-muted-foreground hover:text-foreground">
            Settings
          </a>
        </nav>
      </header>
      <main className="flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
