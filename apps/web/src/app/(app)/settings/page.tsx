"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Brain,
  ChevronDown,
  Eye,
  EyeOff,
  Key,
  RotateCcw,
  Settings,
  Sliders,
  Zap,
} from "lucide-react";
import { useState } from "react";

function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="size-4 text-primary" />
      </div>
      <div>
        <p className="font-medium text-sm">{title}</p>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
    </div>
  );
}

function ApiKeyField({
  label,
  placeholder,
  envVar,
  disabled,
}: {
  label: string;
  placeholder: string;
  envVar: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const inputId = `api-key-${label.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={inputId} className="font-medium text-muted-foreground text-xs">
          {label}
        </label>
        <span className="font-mono text-[10px] text-muted-foreground/50">{envVar}</span>
      </div>
      <div className="relative">
        <Input
          id={inputId}
          type={visible ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
          className="pr-8 font-mono text-xs"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          disabled={disabled}
          className="-translate-y-1/2 absolute top-1/2 right-2 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          aria-label={visible ? "Hide key" : "Show key"}
        >
          {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  defaultOn = false,
}: {
  label: string;
  description: string;
  defaultOn?: boolean;
}) {
  const [on, setOn] = useState(defaultOn);

  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <p className="text-sm">{label}</p>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => setOn((v) => !v)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          on ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block size-4 rounded-full bg-white shadow-lg transition-transform",
            on ? "translate-x-4" : "translate-x-0",
          )}
        />
      </button>
    </div>
  );
}

const MODEL_DEFAULTS = [
  { value: "auto", label: "Auto-route (recommended)" },
  { value: "haiku", label: "Haiku — always fast" },
  { value: "sonnet", label: "Sonnet — always balanced" },
  { value: "opus", label: "Opus — always thorough" },
];

function ModelSelect() {
  const [value, setValue] = useState("auto");
  const [open, setOpen] = useState(false);

  const selectedLabel =
    MODEL_DEFAULTS.find((m) => m.value === value)?.label ?? "Auto-route (recommended)";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-full items-center justify-between rounded-lg border border-input bg-transparent px-2.5 text-sm transition-colors hover:bg-muted/30 focus-visible:border-ring focus-visible:outline-none"
      >
        <span className="text-sm">{selectedLabel}</span>
        <ChevronDown
          className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="absolute top-full z-50 mt-1 w-full rounded-lg border border-border bg-popover py-1 shadow-lg">
          {MODEL_DEFAULTS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => {
                setValue(m.value);
                setOpen(false);
              }}
              className={cn(
                "w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted/50",
                m.value === value && "font-medium text-primary",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
          <Settings className="size-4 text-primary" />
        </div>
        <h1 className="font-semibold text-xl tracking-tight">Settings</h1>
        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-medium text-[10px] text-amber-400">
          Preview — not yet wired up
        </span>
      </div>

      {/* API Keys */}
      <div className="rounded-xl border border-border bg-card/60 p-5">
        <SectionHeader
          icon={Key}
          title="API Keys"
          description="Override default keys for each provider. Leave blank to use environment variables."
        />
        <div className="mt-4 flex flex-col gap-3">
          <ApiKeyField
            label="Anthropic"
            placeholder="sk-ant-…"
            envVar="ANTHROPIC_API_KEY"
            disabled
          />
          <ApiKeyField
            label="OpenAI (fallback)"
            placeholder="sk-…"
            envVar="OPENAI_API_KEY"
            disabled
          />
          <ApiKeyField
            label="Voyage (embeddings)"
            placeholder="pa-…"
            envVar="VOYAGE_API_KEY"
            disabled
          />
          <ApiKeyField label="Cohere (reranker)" placeholder="…" envVar="COHERE_API_KEY" disabled />
        </div>
        <div className="mt-4 flex justify-end">
          <Button size="sm" variant="outline" disabled>
            Save Keys
          </Button>
        </div>
      </div>

      {/* Model Preferences */}
      <div className="rounded-xl border border-border bg-card/60 p-5">
        <SectionHeader
          icon={Brain}
          title="Model Preferences"
          description="Default model routing for new reviews."
        />
        <div className="mt-4 flex flex-col gap-2">
          <p className="font-medium text-muted-foreground text-xs">Default model</p>
          <ModelSelect />
        </div>
      </div>

      {/* Review Behaviour */}
      <div className="rounded-xl border border-border bg-card/60 p-5">
        <SectionHeader
          icon={Sliders}
          title="Review Behaviour"
          description="Fine-tune how the agent approaches reviews."
        />
        <div className="mt-4 flex flex-col divide-y divide-border/50">
          <ToggleRow
            label="Semantic cache"
            description="Re-use results for semantically similar diffs to reduce cost."
            defaultOn={true}
          />
          <ToggleRow
            label="Code retrieval"
            description="Pull in relevant context from indexed repos before reviewing."
            defaultOn={true}
          />
          <ToggleRow
            label="Run tests tool"
            description="Allow the agent to trigger test runs for affected files."
            defaultOn={false}
          />
        </div>
      </div>

      {/* Fast model override note */}
      <div className="flex items-start gap-3 rounded-xl border border-primary/15 bg-primary/5 p-4">
        <Zap className="mt-0.5 size-4 shrink-0 text-primary/70" />
        <div>
          <p className="font-medium text-sm">Settings not yet persisted</p>
          <p className="mt-0.5 text-muted-foreground text-xs">
            This settings UI is a work-in-progress. Changes above are local to this session.
            Configure keys and behaviour via environment variables and{" "}
            <code className="font-mono text-xs">.env.local</code> for now.
          </p>
        </div>
      </div>

      {/* Reset */}
      <div className="flex items-center justify-between rounded-xl border border-destructive/15 bg-destructive/5 p-4">
        <div>
          <p className="font-medium text-destructive/90 text-sm">Reset to defaults</p>
          <p className="text-muted-foreground text-xs">Clear all locally stored preferences.</p>
        </div>
        <Button variant="destructive" size="sm" disabled>
          <RotateCcw className="size-3.5" />
          Reset
        </Button>
      </div>
    </div>
  );
}
