"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import ReactMarkdown from "react-markdown";

import { FindingItem } from "@/components/features/reviews/finding-item";
import { useReviewStream } from "@/components/features/reviews/use-review-stream";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function isModel(v: string | null): v is "haiku" | "sonnet" | "opus" {
  return v === "haiku" || v === "sonnet" || v === "opus";
}

export default function NewReviewPage() {
  return (
    <Suspense fallback={null}>
      <NewReviewForm />
    </Suspense>
  );
}

function NewReviewForm() {
  const params = useSearchParams();
  const initialModel = params.get("model");
  const [diff, setDiff] = useState(params.get("diff") ?? "");
  const [model, setModel] = useState<"haiku" | "sonnet" | "opus">(
    isModel(initialModel) ? initialModel : "sonnet",
  );
  const stream = useReviewStream();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (diff.trim().length === 0) return;
    void stream.run({ diff, model });
  };

  const isStreaming = stream.status === "streaming";

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card className="flex flex-col gap-4 p-6">
        <h1 className="font-semibold text-2xl tracking-tight">New review</h1>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="diff">Paste your diff here</Label>
            <Textarea
              id="diff"
              value={diff}
              onChange={(e) => setDiff(e.target.value)}
              className="min-h-[280px] font-mono text-xs"
              placeholder={"@@ -1,3 +1,3 @@\n-old line\n+new line"}
              disabled={isStreaming}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="model">Model</Label>
            <select
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value as typeof model)}
              disabled={isStreaming}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="haiku">Haiku</option>
              <option value="sonnet">Sonnet</option>
              <option value="opus">Opus</option>
            </select>
          </div>
          <Button type="submit" disabled={isStreaming || diff.trim().length === 0}>
            {isStreaming ? "Running review..." : "Run review"}
          </Button>
        </form>
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">Output</h2>
          <span className="text-muted-foreground text-xs uppercase tracking-wide">
            {stream.status}
          </span>
        </div>

        {stream.ticker.length > 0 ? (
          <ul className="flex flex-col gap-1 text-muted-foreground text-xs">
            {stream.ticker.map((line, i) => (
              <li key={`${i}-${line.slice(0, 12)}`}>· {line}</li>
            ))}
          </ul>
        ) : null}

        {stream.text.length > 0 ? (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{stream.text}</ReactMarkdown>
          </div>
        ) : null}

        {stream.final ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">{stream.final.summary}</p>
            <ul className="flex flex-col gap-2">
              {stream.final.findings.map((finding, i) => (
                <FindingItem key={`${i}-${finding.summary.slice(0, 16)}`} finding={finding} />
              ))}
            </ul>
            <p className="text-muted-foreground text-xs">Confidence: {stream.final.confidence}</p>
          </div>
        ) : null}

        {stream.error ? <p className="text-red-600 text-sm">{stream.error}</p> : null}
      </Card>
    </div>
  );
}
