# Reverse-engineering & interoperability notes

Tooling: REA (installed globally at `/opt/homebrew/bin/rea`, registered as the `rea` MCP server; reused without reinstalling or reconfiguring). Only locally installed, licensed software and documented formats were examined. No DRM, authentication or licensing mechanisms were touched.

## Verified evidence

| # | Observation | Evidence |
|---|---|---|
| 1 | REA's MCP connection is working. | `inspect_desktop_application` completed against the installed `.key`-capable desktop application bundle; evidence id `ev_97e6c251…` (summary view of `ev_3fdbadf5…`). |
| 2 | That application is a native bundle with no managed (.NET/Unity/Godot) or Electron runtime that REA could decode. | Same evidence: 0 runtime candidates, 0 components across 400 examined entries. |
| 3 | The application exposes a documented scripting dictionary with `export` (formats include an Open XML presentation, PDF, images, movie, HTML), `open`, `save`, slide and transition objects, and slideshow control. | The bundle's scripting definition (`Contents/Resources/*.sdef`), read directly. |
| 4 | Its bundle includes frameworks for animation, charts, tables, text and persistence. | Framework directory listing. |
| 5 | DECK's `.pptx` output is accepted and rendered by an independent implementation (LibreOffice). | All 7 template exports converted to PDF with matching page counts; renders inspected. |

## Hypotheses (not verified)

- The native `.key` package stores its object graph in a binary, proprietary serialisation managed by the bundle's persistence framework. **Not verified** — no `.key` file was produced in this environment (see unknowns) and the format is undocumented. DECK therefore does not attempt to read or write `.key` directly.

## Unknowns / blocked

- **`.key` round trip through the application's scripting interface**: the automation permission was granted, but `open` of a `.pptx` timed out twice (60 s, then 180 s), consistent with a modal dialog awaiting user input. Screen capture and accessibility inspection were unavailable, so the dialog could not be identified. Status: blocked until a person dismisses the dialog and the round trip is re-run.

## Design decisions informed by this work

- Interoperability with `.key` is through the documented Open XML presentation format, which that application imports and exports via its own UI and scripting interface.
- DECK's Open XML implementation follows ECMA-376 directly and is validated structurally (`inspectPptx`) and by an independent renderer, rather than by imitating any proprietary implementation.
