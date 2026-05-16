#!/usr/bin/env node
/**
 * AI Code Reviewer — interactive management CLI.
 *
 * Run with `pnpm cli` (or `node scripts/cli.mjs` directly).
 *
 * Adding a new action: drop an entry into the relevant submenu in the
 * `tree` constant below. Each item is one of three shapes:
 *
 *   { label, menu: { title, items } }                — nested submenu
 *   { label, run:  { cmd, args, ...options } }       — shell command
 *   { label, action: async () => unknown }           — inline action
 *
 * Run options:
 *   cmd, args        — argv to spawn. Cross-platform; uses shell on Windows.
 *   cwd              — working directory (defaults to repo root).
 *   env              — extra env vars merged over process.env.
 *   longRunning      — true for dev servers etc. Prints a Ctrl-C hint.
 *   confirm          — string message; user must type 'y' to proceed.
 *
 * Zero deps — only Node 22+ standard library.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import process, { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

// ────────────────────────────────────────────────────────────────────────────
// Environment
// ────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const INDEXER_DIR = path.join(REPO_ROOT, "apps", "indexer");
const IS_WINDOWS = process.platform === "win32";
const COLOR_OK = Boolean(stdout.isTTY) && process.env.NO_COLOR !== "1";

// ────────────────────────────────────────────────────────────────────────────
// ANSI colors (no-op when output is piped or NO_COLOR is set)
// ────────────────────────────────────────────────────────────────────────────

const ansi = (open, close) => (s) => (COLOR_OK ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));

const bold = ansi(1, 22);
const dim = ansi(2, 22);
const red = ansi(31, 39);
const green = ansi(32, 39);
const yellow = ansi(33, 39);
const blue = ansi(34, 39);
const magenta = ansi(35, 39);
const cyan = ansi(36, 39);

// ────────────────────────────────────────────────────────────────────────────
// I/O helpers
// ────────────────────────────────────────────────────────────────────────────

const rl = createInterface({ input: stdin, output: stdout });

function clearScreen() {
  if (stdout.isTTY) stdout.write("\x1b[2J\x1b[H");
}

function hr() {
  return dim("─".repeat(60));
}

async function pause(message = "Press Enter to return to the menu") {
  await rl.question(dim(`\n${message}… `));
}

async function confirm(message) {
  const ans = (await rl.question(`${yellow("?")} ${message} ${dim("[y/N]")} `))
    .trim()
    .toLowerCase();
  return ans === "y" || ans === "yes";
}

// ────────────────────────────────────────────────────────────────────────────
// Child-process runner with live stdio streaming
// ────────────────────────────────────────────────────────────────────────────

/** The currently executing child, or null. Tracked so the global SIGINT
 *  handler can distinguish "Ctrl-C at the prompt" (→ exit CLI) from
 *  "Ctrl-C in a running command" (→ let the child handle it and return
 *  to the menu when it exits). */
let activeChild = null;

function runCommand({ cmd, args = [], cwd = REPO_ROOT, env = {} }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      activeChild = null;
      resolve(result);
    };

    const display = [cmd, ...args].map((p) => (p.includes(" ") ? `"${p}"` : p)).join(" ");
    const cwdRel = path.relative(REPO_ROOT, cwd) || ".";
    console.log(`\n${dim("›")} ${cyan(display)}  ${dim(`(${cwdRel})`)}\n`);

    let child;
    try {
      child = spawn(cmd, args, {
        stdio: "inherit",
        shell: IS_WINDOWS, // pnpm/uv/git on Windows are .cmd shims
        cwd,
        env: { ...process.env, ...env },
      });
    } catch (err) {
      finish({ code: 127, signal: null, error: err });
      return;
    }
    activeChild = child;

    child.on("error", (err) => {
      console.error(red(`\nFailed to start "${cmd}": ${err.message}`));
      finish({ code: 127, signal: null, error: err });
    });
    child.on("exit", (code, signal) => finish({ code, signal }));
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Action dispatcher
// ────────────────────────────────────────────────────────────────────────────

async function executeRun(item) {
  const { label, run } = item;
  const { confirm: confirmMsg, longRunning, cmd, args, cwd, env } = run;

  clearScreen();
  console.log(bold(blue(`▶ ${label}`)));
  console.log(hr());

  if (confirmMsg) {
    console.log(`${red(bold("Warning:"))} ${confirmMsg}\n`);
    if (!(await confirm("Proceed?"))) {
      console.log(dim("Cancelled."));
      await pause();
      return;
    }
  }

  if (longRunning) {
    console.log(dim("Long-running. Press Ctrl-C to stop and return to the menu."));
  }

  const start = Date.now();
  const { code, signal, error } = await runCommand({ cmd, args, cwd, env });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log("");
  if (error) {
    console.log(red(`✗ ${error.message}`));
  } else if (signal) {
    console.log(yellow(`⏹ Stopped by ${signal} after ${elapsed}s`));
  } else if (code === 0) {
    console.log(green(`✓ Completed in ${elapsed}s`));
  } else {
    console.log(red(`✗ Exited with code ${code} after ${elapsed}s`));
  }

  await pause();
}

async function executeAction(item) {
  clearScreen();
  console.log(bold(blue(`▶ ${item.label}`)));
  console.log(hr());
  try {
    await item.action();
  } catch (err) {
    console.error(red(`\n✗ ${err?.message ?? err}`));
  }
  await pause();
}

// ────────────────────────────────────────────────────────────────────────────
// Action tree
// ────────────────────────────────────────────────────────────────────────────

const tree = {
  title: "AI Code Reviewer",
  items: [
    {
      label: "Development",
      menu: {
        title: "Development",
        items: [
          {
            label: "Start web dev server",
            run: {
              cmd: "pnpm",
              args: ["--filter", "@acr/web", "dev"],
              longRunning: true,
            },
          },
          {
            label: "Open Drizzle Studio",
            run: {
              cmd: "pnpm",
              args: ["db:studio"],
              longRunning: true,
            },
          },
        ],
      },
    },
    {
      label: "Build",
      menu: {
        title: "Build",
        items: [
          {
            label: "Build TypeScript packages",
            run: { cmd: "pnpm", args: ["build:packages"] },
          },
          {
            label: "Build web app",
            run: { cmd: "pnpm", args: ["--filter", "@acr/web", "build"] },
          },
          {
            label: "Build everything (turbo)",
            run: { cmd: "pnpm", args: ["build"] },
          },
          {
            label: "Clean all build outputs",
            run: {
              cmd: "pnpm",
              args: ["clean"],
              confirm: "Removes dist/, .next/, .turbo/, and node_modules across the workspace.",
            },
          },
        ],
      },
    },
    {
      label: "Test",
      menu: {
        title: "Test",
        items: [
          { label: "All tests", run: { cmd: "pnpm", args: ["test"] } },
          {
            label: "@acr/shared only",
            run: { cmd: "pnpm", args: ["--filter", "@acr/shared", "test"] },
          },
          {
            label: "@acr/db only",
            run: { cmd: "pnpm", args: ["--filter", "@acr/db", "test"] },
          },
          {
            label: "@acr/agent only",
            run: { cmd: "pnpm", args: ["--filter", "@acr/agent", "test"] },
          },
          {
            label: "@acr/web only",
            run: { cmd: "pnpm", args: ["--filter", "@acr/web", "test"] },
          },
          {
            label: "Python tests (indexer)",
            run: { cmd: "uv", args: ["run", "pytest"], cwd: INDEXER_DIR },
          },
        ],
      },
    },
    {
      label: "Quality",
      menu: {
        title: "Quality",
        items: [
          { label: "Lint (Biome)", run: { cmd: "pnpm", args: ["lint"] } },
          {
            label: "Lint & auto-fix (Biome)",
            run: { cmd: "pnpm", args: ["lint:fix"] },
          },
          { label: "Format (Biome)", run: { cmd: "pnpm", args: ["format"] } },
          { label: "Typecheck", run: { cmd: "pnpm", args: ["typecheck"] } },
          {
            label: "Ruff check (Python)",
            run: { cmd: "uv", args: ["run", "ruff", "check", "."], cwd: INDEXER_DIR },
          },
          {
            label: "Ruff format (Python)",
            run: { cmd: "uv", args: ["run", "ruff", "format", "."], cwd: INDEXER_DIR },
          },
        ],
      },
    },
    {
      label: "Database",
      menu: {
        title: "Database",
        items: [
          {
            label: "Generate migration",
            run: { cmd: "pnpm", args: ["db:generate"] },
          },
          {
            label: "Apply migrations",
            run: {
              cmd: "pnpm",
              args: ["db:migrate"],
              confirm: "Applies pending migrations to the configured DATABASE_URL.",
            },
          },
          {
            label: "Open Drizzle Studio",
            run: { cmd: "pnpm", args: ["db:studio"], longRunning: true },
          },
        ],
      },
    },
    {
      label: "Evals",
      menu: {
        title: "Evals",
        items: [
          {
            label: "Retrieval recall benchmark (retrieval-v0)",
            run: {
              cmd: "pnpm",
              args: ["bench:retrieval"],
              confirm:
                "Truncates the fixture repo's rows in chunks/documents/repos on the configured DATABASE_URL.",
            },
          },
        ],
      },
    },
    {
      label: "Indexer (Python)",
      menu: {
        title: "Indexer",
        items: [
          {
            label: "Sync dependencies (uv sync)",
            run: { cmd: "uv", args: ["sync"], cwd: INDEXER_DIR },
          },
          {
            label: "Ruff check",
            run: { cmd: "uv", args: ["run", "ruff", "check", "."], cwd: INDEXER_DIR },
          },
          {
            label: "Ruff format",
            run: { cmd: "uv", args: ["run", "ruff", "format", "."], cwd: INDEXER_DIR },
          },
          {
            label: "Pytest",
            run: { cmd: "uv", args: ["run", "pytest"], cwd: INDEXER_DIR },
          },
        ],
      },
    },
    {
      label: "Git",
      menu: {
        title: "Git",
        items: [
          { label: "Status", run: { cmd: "git", args: ["status"] } },
          {
            label: "Recent commits (last 10)",
            run: { cmd: "git", args: ["log", "--oneline", "-10"] },
          },
          {
            label: "Diff working tree",
            run: { cmd: "git", args: ["diff", "--stat"] },
          },
          {
            label: "Push current branch",
            run: {
              cmd: "git",
              args: ["push"],
              confirm: "Pushes the current branch to origin.",
            },
          },
        ],
      },
    },
    {
      label: "About",
      action: async () => {
        const info = [
          `${bold("AI Code Reviewer")}`,
          `${dim("Repo:")}   ${REPO_ROOT}`,
          `${dim("Node:")}   ${process.version}`,
          `${dim("OS:")}     ${process.platform} ${process.arch}`,
        ].join("\n");
        console.log(`\n${info}`);
      },
    },
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// Menu rendering + navigation
// ────────────────────────────────────────────────────────────────────────────

function renderMenu(menu, breadcrumb) {
  clearScreen();
  console.log(magenta(bold(`◆ ${breadcrumb.join(" / ")}`)));
  console.log(hr());
  menu.items.forEach((item, i) => {
    const num = bold(String(i + 1).padStart(2, " "));
    const arrow = item.menu ? dim("  →") : "";
    console.log(`  ${num}. ${item.label}${arrow}`);
  });
  console.log(hr());
  const exitLabel = breadcrumb.length === 1 ? "Exit" : "Back";
  console.log(`   ${bold("0")}. ${dim(exitLabel)}\n`);
}

async function readChoice(maxIndex) {
  while (true) {
    const raw = (await rl.question(`${cyan("›")} Select [0-${maxIndex}]: `)).trim();
    if (raw === "") continue;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0 && n <= maxIndex) return n;
    console.log(red(`  Invalid choice "${raw}".`));
  }
}

async function navigate(menu, breadcrumb = [menu.title]) {
  while (true) {
    renderMenu(menu, breadcrumb);
    const choice = await readChoice(menu.items.length);
    if (choice === 0) return;

    const item = menu.items[choice - 1];
    try {
      if (item.menu) {
        await navigate(item.menu, [...breadcrumb, item.menu.title]);
      } else if (item.run) {
        await executeRun(item);
      } else if (item.action) {
        await executeAction(item);
      } else {
        console.log(red(`Unhandled item: ${item.label}`));
        await pause();
      }
    } catch (err) {
      console.error(red(`\nError: ${err?.message ?? err}`));
      await pause();
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Entry point
// ────────────────────────────────────────────────────────────────────────────

// SIGINT handling:
//   - With a running child (stdio: inherit), the terminal delivers SIGINT
//     to BOTH the child and us. The child handles it (exits / cleans up);
//     we swallow it so the menu loop survives.
//   - At a prompt, SIGINT means "user wants to leave" → exit cleanly.
process.on("SIGINT", () => {
  if (activeChild) return;
  console.log("");
  process.exit(0);
});

try {
  await navigate(tree);
  console.log(dim("\nGoodbye."));
} finally {
  rl.close();
}
