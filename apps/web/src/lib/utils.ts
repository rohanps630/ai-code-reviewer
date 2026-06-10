import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Extract a human-readable message from an unknown thrown value. */
export function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "Unknown error";
}
