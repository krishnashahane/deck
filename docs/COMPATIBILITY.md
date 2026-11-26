# File compatibility

DECK reads and writes **ECMA-376 Office Open XML presentations** (`.pptx`, and `.potx` for import). Unit conversion: 1 DECK slide unit = 1/96 inch = 9525 EMU, so geometry round-trips without drift.

## How it was verified

| Check | Method | Result |
|---|---|---|
| Package structure | `inspectPptx` validates content types, every relationship target, duplicate ids, slide list | 0 errors for all templates and the feature-rich test deck |
| Round trip | export → import → export → re-import, compared field by field (`packages/core/test/pptx.test.ts`) | Pass |
| Browser export | Playwright downloads the `.pptx` from the UI and validates it | Pass |
| Independent renderer | LibreOffice (headless) converted all 7 template exports to PDF; page counts match slide counts; renders inspected visually | Pass (fonts substituted when the bundled fonts are not installed) |
| `.key` round trip through a desktop presentation application's scripting interface | open `.pptx` → save `.key` → export `.pptx` → import into DECK | **Blocked**: the application accepted automation but its `open` call timed out behind a modal dialog that requires a person to dismiss. Not verified. |

## Element matrix (.pptx)

| Element / feature | Import | Export | Notes |
|---|---|---|---|
| Slide size (any, incl. portrait) | ✅ | ✅ | |
| Text boxes, placeholders (title/body/subtitle) | ✅ | ✅ | Placeholder geometry and text styles inherited from layout and master on import |
| Runs: bold, italic, underline, strike, colour, size, font, highlight, hyperlinks | ✅ | ✅ | Theme colours (`schemeClr` + lumMod/lumOff/tint/shade/alpha) resolved to RGB |
| Paragraphs: alignment, bullets, numbering, levels, line spacing, space before/after | ✅ | ✅ | Numbering exported as arabic period |
| Vertical anchor, insets, shrink-to-fit | ✅ | ✅ | |
| Preset shapes | ✅ 14 kinds + ~15 aliases | ✅ | Other presets approximated as rectangles — **reported** |
| Custom geometry (freeform) | 🟡 | — | Approximated as rectangle — **reported** |
| Solid / gradient / image / pattern fills | ✅ / ✅ / ✅ / 🟡 | ✅ / ✅ / ✅ / — | Pattern → foreground colour, reported |
| Outlines (width, dash), shadows | ✅ | ✅ | |
| Rotation | ✅ | ✅ | Flips not preserved — reported |
| Groups | 🟡 | 🟡 | Imported flattened with a shared group id (selection behaves as a group); exported as individual shapes. Rotated groups reported |
| Pictures: crop, ellipse/rounded masks, transparency, alt text | ✅ | ✅ | |
| SVG pictures | ✅ (prefers the SVG original) | ✅ | PNG fallback rasterised in the browser |
| Lines & connectors (arrows, elbow/curved, connection sites) | ✅ | ✅ | |
| Tables (header row, banding, cell fills, alignment) | ✅ | ✅ | Merged cells imported unmerged — reported |
| Charts: column, bar, line, area, pie, doughnut, scatter (+ title, legend, data labels, series colours) | ✅ | ✅ | Data from chart caches; no embedded workbook is written. 3-D charts imported as 2-D — reported |
| Video and audio | ✅ | ✅ | Embedded media; external links are not fetched — reported |
| Speaker notes | ✅ | ✅ | |
| Hidden slides, sections | ✅ | ✅ | |
| Transitions: fade, push, wipe, cover, zoom, split, auto-advance | ✅ | ✅ | `smart move` and `flip` export as fade — reported in export notes |
| Animations: appear, fade, fly, wipe, zoom; grow, spin, pulse; motion paths; click/with/after; delays; trigger objects | ✅ | ✅ | `rise`, `blur`, `shake`, `color` export as the nearest standard preset — reported |
| Themes (colour scheme, major/minor fonts) | ✅ | ✅ | |
| Masters & layouts | 🟡 | 🟡 | Imported masters drive geometry/styles/backgrounds; DECK writes its own master with 9 layouts |
| Equations | 🟡 | 🟡 | Exported as LaTeX text (re-imported by DECK as an equation); native equation markup not written |
| SmartArt-style diagrams, OLE objects, other graphic frames | 🟡 | 🟡 | Kept as positioned read-only placeholders; re-exported verbatim when self-contained — reported |
| Ink | ⏸ | — | Reported |
| Macros | Never imported or executed | — | Reported |
| Embedded fonts | ⏸ | ⏸ | |

Every approximation above is written to the document's **import report** (Review tab) or returned as an **export note**.

## `.key` packages

Native `.key` files are a proprietary package format with no public specification. DECK does **not** read or write them directly; attempting to open one shows an explanation instead of guessing.

Recommended workflow:

1. In the application that created the `.key` file, export it as `.pptx`.
2. Import the `.pptx` into DECK (drag it onto the home screen).
3. To go back, export `.pptx` from DECK and open it in that application.

An automated round trip through that application's documented scripting interface is prepared (`.interop/` locally, not committed) but could not be completed in this environment — see the verification table.
