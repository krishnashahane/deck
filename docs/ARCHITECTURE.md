# Architecture

```
┌──────────────────────── apps/web (React + Vite) ────────────────────────┐
│  Home · Editor (Rail · Stage · Inspector · Timeline · Palette · Dialogs) │
│  Show / Presenter (Web Animations API, BroadcastChannel sync)            │
│        │ immutable updates                    ▲ Presentation snapshot    │
│        ▼                                      │                          │
│  EditorStore ──► DeckDoc (packages/core, Yjs) ┘                          │
│        │                 │            │                                  │
│   y-indexeddb      y-websocket    .pptx / PDF / .deck                    │
└────────┼─────────────────┼───────────────────────────────────────────────┘
         │ autosave         │ authenticated WebSocket (cookie + role)
         ▼                  ▼
     IndexedDB     ┌──── apps/server (Express) ────┐
                   │ auth · RBAC · links · comments │
                   │ versions · AI proxy · SyncServer│──► PostgreSQL
                   └────────────────────────────────┘
```

## Document model (`packages/core/src/model.ts`)
A `Presentation` holds slide size, a theme, slides and asset metadata. Slides hold ordered elements (z-order = array order), notes, a transition and an ordered animation list. Coordinates are **slide units** (1 unit = 1 CSS px at 100 %, default slide 1920×1080), converted to EMU only at the file boundary.

Element types: text, shape, image, line/connector, table, chart, media, equation, and `raw` (imported content DECK preserves but cannot edit).

## Single source of truth: Yjs (`ydoc.ts`)
`DeckDoc` maps the presentation onto a Y.Doc: maps for metadata, an array for slide order, a map of slide maps (each with an element-order array and a map of per-element field maps), and maps for asset metadata and bytes.

- The UI computes the next immutable `Presentation`; `commit()` diffs it against the current state and writes only changed fields in one transaction — small, mergeable updates.
- Reading back rebuilds only slides whose Y subtree changed (`observeDeep` dirty set), so editing one slide of a 500-slide deck is cheap (unit test: < 100 ms).
- **Undo/redo** is `Y.UndoManager` tracking only local transactions, so undo never reverts collaborators' work. Rapid edits (drag, typing) are coalesced by key.
- **Persistence & recovery**: `y-indexeddb` writes every update; reload replays them (crash-safe, offline).
- **Collaboration**: the same updates flow over `y-websocket` to the server's `SyncServer`; concurrent edits to different fields merge; same-field edits are last-writer-wins; concurrent reorders converge and are de-duplicated.

## Rendering (`apps/web/src/render`)
Slides render as **SVG** (one `viewBox` in slide units) so the same component draws the canvas, thumbnails, presenter view, slideshow and print pages at any zoom with exact geometry. Text uses `foreignObject` for real line-wrapping and font shaping; charts are native SVG; equations use KaTeX. The thumbnail rail is windowed (only visible items mount), measured at ~2 s to import and open a 300-slide deck and ~28 ms per slide change.

## Editing (`apps/web/src/editor`)
- `Stage` is a transparent hit layer over the SVG: rotated hit-testing, move/resize/rotate, marquee, drawing tools, connector endpoints, smart guides (`core/ops.ts#snap`), and in-place text/table editing.
- Text editing uses a `contentEditable` overlay rendered with the same paragraph model; on input it is parsed back to runs (`richtext.ts`).
- All commands live in `actions.ts` and are shared by toolbar, context bar, menus, shortcuts and the command palette.

## Animation engine (`core/animation.ts`, `web/present/engine.ts`)
`buildSteps` turns the ordered list (click / with / after, delays, trigger objects) into steps with absolute offsets. The player animates SVG groups with the Web Animations API using keyframes from core, applies persistent end states (motion paths, grow) and can reconstruct any step instantly when navigating backwards. Transitions animate two stacked layers; *smart move* matches objects by name or id across slides and morphs their geometry.

## File formats (`core/pptx`)
Import walks the package through `SafeZip`/safe XML, resolves relationships, theme colours, placeholder inheritance (slide → layout → master), groups, charts, tables, media, notes, transitions and timing trees. Export writes a complete package (theme, master, 9 layouts, slides, notes master, charts, media, sections, timing). See `COMPATIBILITY.md`.

## Server (`apps/server`)
Express with JSON APIs under `/api`, a WebSocket endpoint at `/sync/:docId`, PostgreSQL for users, sessions, documents (Y state), members, links, comments, versions and the audit log. The server also serves the built web app in production. See `SECURITY.md`.

## AI layer
Provider-independent interface in the client (`lib/ai.ts`): an on-device heuristic provider and a server provider. The server provider calls the Anthropic Messages API with structured JSON output, refusal fallbacks enabled and a server-owned system prompt. Results are proposals shown as diffs; accepting applies them as a normal undoable change.
