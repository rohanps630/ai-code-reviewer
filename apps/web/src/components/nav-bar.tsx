"use client";

import { cn } from "@/lib/utils";
import { Bot, Database, GitPullRequest, Plus, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  {
    href: "/reviews",
    label: "Reviews",
    icon: GitPullRequest,
    isActive: (p: string) =>
      p === "/reviews" || (p.startsWith("/reviews/") && p !== "/reviews/new"),
  },
  {
    href: "/reviews/new",
    label: "New Review",
    icon: Plus,
    isActive: (p: string) => p === "/reviews/new",
  },
  {
    href: "/repos",
    label: "Repos",
    icon: Database,
    isActive: (p: string) => p === "/repos" || p.startsWith("/repos/"),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    isActive: (p: string) => p === "/settings" || p.startsWith("/settings/"),
  },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <header className="fixed inset-x-0 top-0 z-50 h-14 border-white/5 border-b bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-full max-w-7xl items-center gap-1 px-4">
        <Link href="/" className="mr-5 flex shrink-0 items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-indigo-500/25 shadow-lg">
            <Bot className="size-3.5 text-white" />
          </div>
          <span className="font-semibold text-sm tracking-tight">ACR</span>
        </Link>

        <nav className="flex items-center gap-0.5">
          {NAV_ITEMS.map(({ href, label, icon: Icon, isActive }) => {
            const active = isActive(pathname);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium text-sm transition-all duration-150",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                )}
              >
                <Icon className="size-3.5 shrink-0" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
