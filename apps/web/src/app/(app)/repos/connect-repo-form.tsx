"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Globe, Loader2 } from "lucide-react";
import { useState } from "react";

export function ConnectRepoForm() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setStatus("submitting");
    setMessage("");

    try {
      const res = await fetch("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      if (res.ok) {
        setStatus("success");
        setMessage("Repository connected. Run the indexer to start indexing.");
        setUrl("");
        // Reload to show updated list
        setTimeout(() => window.location.reload(), 1500);
      } else {
        const text = await res.text().catch(() => res.statusText);
        setStatus("error");
        setMessage(text || "Failed to connect repository.");
      }
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Request failed.");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Globe className="-translate-y-1/2 absolute top-1/2 left-2.5 size-3.5 text-muted-foreground" />
          <Input
            type="url"
            placeholder="https://github.com/owner/repo"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={status === "submitting"}
            className="pl-8 font-mono text-xs"
          />
        </div>
        <Button
          type="submit"
          disabled={status === "submitting" || !url.trim()}
          size="sm"
          className={cn(
            "shrink-0",
            status !== "submitting" &&
              "bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-primary/20 shadow-sm hover:brightness-110",
          )}
        >
          {status === "submitting" ? <Loader2 className="size-3.5 animate-spin" /> : "Connect"}
        </Button>
      </div>

      {message ? (
        <p className={cn("text-xs", status === "success" ? "text-emerald-400" : "text-red-400")}>
          {message}
        </p>
      ) : null}
    </form>
  );
}
