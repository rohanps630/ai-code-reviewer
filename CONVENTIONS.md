# Conventions — Aider entry point

The canonical conventions for this repo live in **`AGENTS.md`** at the root. Aider does not
auto-read `AGENTS.md`, so load it explicitly:

```bash
aider --read AGENTS.md
```

or add it to `.aider.conf.yml`:

```yaml
read: AGENTS.md
```

Everything in `AGENTS.md` — stack choices, folder structure, naming, commit format, and the
"never do" rules — applies. This file is a pointer; do not add unique guidance here.
