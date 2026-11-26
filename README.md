# DECK

A secure, collaborative presentation editor. Design slides on a precise canvas, animate them, present with a presenter view, work together in real time, and open and save ECMA-376 Open XML presentations (`.pptx`).

- **Local-first.** Every presentation is a CRDT document saved to the browser's IndexedDB on every change, with automatic local snapshots that restore a document if browser storage is lost. Works offline and survives crashes and reloads.
- **Collaborative.** Optional server adds accounts, sharing, roles, comments, version history and live multi-user editing over authenticated WebSockets.
- **Interoperable.** `.pptx` import and export with an explicit import report — nothing is dropped silently.
- **Secure by design.** Hostile-file defences, strict CSP, CSRF protection, server-side authorisation, hashed credentials, MFA, audit log.

## Quick start (development)

Requirements: Node.js ≥ 22.19 and PostgreSQL ≥ 14.

```bash
npm install
# PostgreSQL: point DATABASE_URL at an empty database (default postgres://deck@localhost:5439/deck)
npm run dev:server        # API + sync on :8787
npm run dev:web           # editor on http://localhost:5173
```

The editor works without the server (local mode: everything except accounts, sharing and server-side AI).

## Tests

```bash
npm test                  # unit + integration (core, file formats, security, server, collaboration) — needs Postgres (deck_test DB)
npm run test:e2e          # Playwright end-to-end in Chromium (starts its own servers)
npm run typecheck
npm run audit             # npm dependency audit
```

Current results: **51 unit/integration tests** and **11 end-to-end tests** pass (e2e suite green on repeated runs); `npm audit` reports 0 vulnerabilities.

## Project layout

| Path | Contents |
|---|---|
| `packages/core` | Document model, Yjs binding, themes, layouts, templates, animation sequencing, geometry/snapping, `.pptx` import/export, file-security primitives |
| `apps/web` | React + Vite editor, renderer, slideshow, presenter view, AI assistant UI |
| `apps/server` | Express + PostgreSQL API, authentication, RBAC, sharing, comments, versions, Yjs sync server, AI proxy |
| `e2e` | Playwright end-to-end tests |
| `scripts` | Interoperability helpers |
| `docs` | Architecture, security report, compatibility matrix, deployment, reverse-engineering notes |

## Capability status

Legend: ✅ implemented & tested · 🟡 partially supported · ⚪ implemented, not independently verified · ⏸ deferred · ⛔ blocked

| Area | Capability | Status |
|---|---|---|
| Slides | Create, duplicate, delete, reorder (drag & drop, multi-select), hidden slides, sections, notes, outline view | ✅ |
| Content | Text, rich text runs, shapes (14), lines/connectors that follow objects, images (crop, mask, alt text), tables, charts (7 kinds, data editor), equations (LaTeX), video/audio, hyperlinks (web & slide) | ✅ (e2e covers shapes, tables, charts, text; others unit/manual) |
| Arrange | Group/ungroup, align, distribute, z-order, lock, rotation, resize with aspect lock, smart guides with spacing labels, snapping, grid, zoom & pan | ✅ (manual + unit) |
| Typography | Fonts (5 bundled OFL families + system), sizes, weight, italic, underline, strike, colour, highlight, alignment, line height, letter spacing, bullets/numbering with levels, text effects, shrink-to-fit, Unicode/RTL text | 🟡 RTL layout not specifically tuned |
| Design | 8 themes, 9 layout masters, re-theming, brand kits, backgrounds (solid/gradient/image), gradient fills, shadows, 7 professional templates | ✅ |
| Animation | Entrance/exit/emphasis/motion-path effects, click/with/after sequencing, delays, durations, easing, trigger objects, timeline editor, previews | ✅ |
| Transitions | Fade, push, wipe, cover, zoom, split, flip, smart move (object matching), auto-advance | ✅ (fade/push e2e; others manual) |
| Presenting | Full-screen show, keyboard control, presenter view (notes, next slide, timers), laser pointer, pen, black/white screen, recording to WebM | ✅ show & keyboard (e2e); ⚪ recording, presenter window sync |
| Export | `.pptx`, PDF/print (one page per slide), native `.deck` | ✅ |
| Import | `.pptx`/`.potx` with import report; `.deck` | ✅ |
| `.key` | Native read/write | ⏸ (see compatibility matrix; interop via `.pptx`) |
| Collaboration | Real-time co-editing, presence/cursors, comments & replies, versions, offline + resync | ✅ |
| Accounts | Register, login, scrypt hashing, TOTP MFA, sessions list/revoke, password recovery | ✅ (email delivery needs an operator-configured relay) |
| Sharing | Owner/editor/commenter/viewer, invites, expiring revocable links | ✅ |
| AI | On-device heuristics; server-side provider with consent, schema-validated proposals, fact flags | ✅ heuristics & server guards; ⚪ live provider call (needs API key) |
| Storage | PostgreSQL document store; S3-compatible object storage | ✅ Postgres; ⏸ S3 (assets live inside documents) |
| Font embedding in `.pptx` | | ⏸ |

See [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) for element-by-element file-format behaviour and [docs/SECURITY.md](docs/SECURITY.md) for the security report.

## Licence of bundled assets

Fonts: Inter, Space Grotesk, Fraunces, Playfair Display, JetBrains Mono — SIL Open Font License 1.1. Icons are original to DECK.
