# Agent Guidelines: Open Knowledge Format (OKF v0.2) in `context/`

Knowledge documents in `context/` follow **OKF v0.2**. Read `context/index.md` first and navigate progressively via subdirectory `index.md` files before loading full documents.

## 1. Concept Frontmatter Schema

Every `.md` file (except `index.md`, `log.md`, `AGENTS.md`, `README.md`) **MUST** begin with YAML frontmatter:

```yaml
---
type: <Concept Type>               # REQUIRED (match neighboring files in the same directory)
title: <Display Name>              # RECOMMENDED
description: <One-line summary>    # RECOMMENDED
tags: [<tag1>, <tag2>]             # Optional
status: stable                     # draft (unverified) | stable | deprecated
generated:
  by: <actor>                      # REQUIRED: agent:<model>, human:<id>, or process:<tool>
  at: <ISO-8601>                   # REQUIRED: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ
verified:                          # Optional (confers machine/human trust tier)
  - by: <actor>                    # process:<tool> or human:<id>
    at: <ISO-8601>
sources:                           # Optional (required if body uses [^id] footnotes)
  - id: <footnote-id>
    resource: <path-or-uri>
    title: <label>
---
```

## 2. Structural & Maintenance Rules

- **Index Files:** Only root `context/index.md` has frontmatter (`okf_version: "0.2"`). Subdirectory `index.md` files must **not** have frontmatter.
- **Internal Links:** Use bundle-relative root paths (e.g. `/architecture.md` or `/ma-api-docs/music-assistant-api.md`) or relative paths.
- **Modularization:** Keep individual concept files under ~200 lines; split larger initiatives into sub-documents indexed in their directory `index.md`.
- **Audit Log (`context/log.md`):** Append an entry under `## YYYY-MM-DD` whenever creating or significantly updating concepts.
- **Linter Validation:** Always run after editing `context/`:
  ```bash
  npm run context:lint
  ```
