import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-4 text-center">
      <div className="flex flex-col items-center gap-3">
        <span className="bg-gradient-to-b from-foreground to-foreground/40 bg-clip-text font-extrabold text-8xl text-transparent tracking-tighter">
          404
        </span>
        <h1 className="font-semibold text-xl tracking-tight">Page not found</h1>
        <p className="max-w-sm text-muted-foreground text-sm leading-relaxed">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
      </div>

      <Link
        href="/reviews"
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground text-sm shadow-sm transition-colors hover:bg-primary/90"
      >
        <ArrowLeft className="size-3.5" />
        Back to reviews
      </Link>
    </div>
  );
}
