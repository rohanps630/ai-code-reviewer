import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-1.5 py-0.5 font-medium text-xs ring-1 ring-inset transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary/10 text-primary ring-primary/20",
        secondary: "bg-secondary text-secondary-foreground ring-border",
        outline: "text-foreground ring-border",
        success:
          "bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/30",
        warning:
          "bg-amber-500/10 text-amber-600 ring-amber-500/20 dark:bg-amber-500/15 dark:text-amber-400 dark:ring-amber-500/30",
        destructive:
          "bg-red-500/10 text-red-600 ring-red-500/20 dark:bg-red-500/15 dark:text-red-400 dark:ring-red-500/30",
        // Review status
        pending:
          "bg-slate-500/10 text-slate-600 ring-slate-500/20 dark:bg-slate-500/15 dark:text-slate-400 dark:ring-slate-500/25",
        streaming:
          "bg-blue-500/10 text-blue-600 ring-blue-500/20 dark:bg-blue-500/15 dark:text-blue-400 dark:ring-blue-500/25",
        completed:
          "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/30",
        failed:
          "bg-red-500/10 text-red-700 ring-red-500/20 dark:bg-red-500/15 dark:text-red-400 dark:ring-red-500/30",
        // Finding severity
        critical:
          "bg-red-500/10 text-red-700 ring-red-500/25 dark:bg-red-500/15 dark:text-red-400 dark:ring-red-500/35",
        major:
          "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:bg-amber-500/15 dark:text-amber-400 dark:ring-amber-500/35",
        minor:
          "bg-slate-500/10 text-slate-700 ring-slate-500/20 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/25",
        // Cache status
        exact:
          "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:bg-violet-500/15 dark:text-violet-400 dark:ring-violet-500/25",
        semantic:
          "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:bg-sky-500/15 dark:text-sky-400 dark:ring-sky-500/25",
        miss: "bg-slate-500/8 text-slate-600 ring-slate-500/15 dark:bg-slate-500/8 dark:text-slate-500 dark:ring-slate-500/20",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
