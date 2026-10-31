---
okf_version: "0.2"
title: Musikbar Context Index
description: Progressive disclosure index of architectural and API documentation for Musikbar.
---

# Musikbar Knowledge Bundle

This knowledge bundle follows the Open Knowledge Format (OKF v0.2).

## Core Documentation

- [/architecture.md](/architecture.md): Application architecture, Tauri v2 menubar host, React frontend, and state/event synchronization model.
- [/ma-api-docs/music-assistant-api.md](/ma-api-docs/music-assistant-api.md): Music Assistant WebSocket and HTTP API reference, core command catalog, and metadata handling logic (generated via `npm run docs:update`).

## Maintenance & Guidelines

- [/AGENTS.md](/AGENTS.md): OKF v0.2 guidelines, frontmatter specification, and structural rules for the `context/` directory.
- [/log.md](/log.md): Audit log recording all document creations and updates.
- **Linter**: Run `npm run context:lint` to validate all documents against OKF v0.2.
