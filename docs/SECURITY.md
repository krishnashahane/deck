# Security report

Scope: `packages/core`, `apps/web`, `apps/server` at the time of writing. Every control below is backed by an automated test unless marked otherwise.

## Threat model

| Asset | Threats considered |
|---|---|
| Presentations (content, media, comments) | Unauthorised read/write (IDOR, privilege escalation, stolen links), data loss |
| Accounts & sessions | Credential stuffing, brute force, session theft, CSRF, account enumeration |
| Users' browsers | XSS from imported files or malicious collaborators, malicious SVG/media, clickjacking |
| Server | ZIP bombs, XML attacks (XXE, entity expansion), path traversal, oversized payloads, SQL injection, SSRF |
| AI provider | Prompt injection from document content, credential exposure, unintended data disclosure |

## Controls

### Authentication (`apps/server/src/auth.ts`, `security.ts`)
- Passwords hashed with **scrypt** (N=2¹⁵, r=8, p=1, 16-byte salt); minimum 12 characters; trivial passwords rejected. ✅ tested
- Identical response and timing path for unknown email vs wrong password (dummy hash). ✅
- Account lockout after 10 failures for 15 minutes; per-IP rate limits on auth routes (default 30/min) and the API (600/min). ✅
- Sessions: 256-bit random tokens in `HttpOnly; SameSite=Lax` cookies (`Secure` in production); only SHA-256 hashes stored; 14-day sliding expiry; list/revoke one/revoke others. ✅
- Optional **TOTP MFA** (RFC 6238); login without a valid code issues no session. ✅
- Password recovery: single-use, 30-minute tokens stored hashed; response never reveals whether the email exists; a reset revokes every session. ✅
- Email delivery uses an operator-configured relay (`DECK_MAIL_WEBHOOK`); without it, production logs that mail was not sent (it never prints tokens in production).

### Authorisation (`apps/server/src/docs.ts`)
- Roles: owner, editor, commenter, viewer, stored per document; **every** route resolves the caller's role server-side. ✅
- Non-members receive **404**, so document ids cannot be probed (IDOR). ✅
- Escalation attempts (editor inviting, viewer editing/commenting, owner-via-link) are refused. ✅
- Share links: 192-bit tokens shown once and stored hashed; optional expiry; revocable; accepting a link never downgrades an existing role and never grants owner. ✅
- Removing a member or revoking sessions immediately **disconnects** live sync sockets (close code 4401). ✅

### Real-time sync (`apps/server/src/sync.ts`)
- WebSocket upgrade requires a valid session cookie, an allowed `Origin`, and membership. ✅
- Viewer/commenter connections may receive updates and share presence, but **document updates they send are dropped**. ✅
- 64 MB message limit, malformed messages close the socket, heartbeats remove dead peers; documents above the configured size are not persisted.

### Web security
- **CSRF**: double-submit token (`deck_csrf` cookie + `X-Deck-CSRF` header) **and** Origin allow-list on every state-changing request. ✅
- **CSP**: `default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'` plus `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, HSTS in production. ✅ (verified in a browser against the production build: no violations). `style-src` allows inline styles because the renderer positions content with style attributes; no inline scripts are allowed.
- **XSS**: the renderer builds DOM through React (no HTML strings) except two audited sinks:
  - KaTeX output with `trust: false` and size/expansion limits.
  - The rich-text editor's HTML builder: all text escaped; colours, numbers, alignment, fonts and link targets validated before use. A regression test feeds hostile values. ✅
- Pasted content into text boxes is inserted as plain text only.
- Hyperlinks open only for `http:`, `https:` and `mailto:` with `noopener,noreferrer`. ✅
- No remote URLs are loaded for images/media: only content-addressed assets embedded in the document (prevents tracking pixels and SSRF-by-proxy).
- Errors never return stack traces. ✅

### Hostile files (`packages/core/src/security.ts`, `xml.ts`, `pptx/import.ts`)
- Files are identified by **content signatures**, not extensions. ✅
- ZIP: entry count, per-entry and total declared size, compression-ratio (bomb) checks before inflation, actual inflated size re-checked, CRC verified. ✅
- Paths: absolute paths, `..`, backslashes, drive letters and control characters rejected; relationship targets cannot escape the package root. ✅
- XML: any `DOCTYPE`/`ENTITY` declaration is rejected (no XXE, no entity expansion). ✅
- SVG: strict allow-list sanitiser (no scripts, event handlers, `foreignObject`, external references or `url()` fetches). ✅
- Macros (`vbaProject.bin`, macro-enabled content types) are reported and never imported or executed; OLE objects are never executed. ✅
- Originals are never modified; imports create a new document.

### AI (`apps/server/src/ai.ts`, `apps/web/src/lib/ai.ts`)
- Provider credentials exist only on the server; the browser never sees them.
- Each request requires an explicit consent flag that the UI sets only after the user ticks a disclosure checkbox stating exactly what will be sent. ✅
- The server owns the system prompt; document text is wrapped as untrusted data and the model is instructed never to follow instructions inside it. Responses are constrained to a JSON schema; rewrite targets are filtered to ids that were sent.
- Figures and links that appear in output but not in the input are flagged as unverified; nothing is applied until the user accepts.
- Rate-limited per user (20/min); every request is audit-logged (task, size, model — not content).

### Data protection & audit
- All SQL uses parameters. Audit log records auth events, sharing changes, restores, sync kicks and AI requests.
- **Visible audit:** each user can see their own recent security events (sign-ins, failed attempts, lockouts, MFA and password changes, with the IP of each event) on the account page, with a warning when failed attempts occurred. ✅
- Document owners can see an access activity log (invites, role changes, removals, links created/revoked/used, restores). Other roles get 403, non-members 404, and **collaborators' IP addresses are never exposed** to owners. ✅
- Local documents never leave the device unless the user explicitly moves one to the server.

### Static hosting (`vercel.json`)
- The hosted editor sends the same strict CSP (with `connect-src 'self'` — no sockets to other hosts), HSTS with preload, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin`, a restrictive `Permissions-Policy`, and `Referrer-Policy: no-referrer`. Verified against the live deployment.
- Source maps are not published for hosted builds; `.vercelignore` excludes local data, environment files and test output from uploads. Verified: `.env`, `.env.local`, database files, server source, `package.json` and `*.map` all return 404.

## Verification

| Check | Result |
|---|---|
| `npm audit` (all workspaces) | 0 vulnerabilities |
| Unit/integration tests (security-relevant subset: 25+) | pass |
| End-to-end tests | 13/13 pass |
| Source scan for `eval`, `new Function`, `child_process`, raw `innerHTML` | only the two audited sinks above |

## Issues found and fixed during the review
1. **XSS via style injection in the rich-text editor** — colour/font values from a document were concatenated into an HTML `style` attribute. Fixed with strict validation and escaping; regression test added.
2. **Escape key did not close dialogs/menus** when focus was inside them, and dialogs briefly moved focus on every re-render — fixed.
3. **Local data durability**: browser storage can be evicted. DECK now requests persistent storage, keeps automatic local snapshots (20 per document) and restores from the latest snapshot automatically; covered by an end-to-end test.
4. **Snapshot store could fail to initialise** if an empty database already existed — fixed by a versioned upgrade that always ensures the store.

## Known limitations / deferred
- No external penetration test has been performed.
- Email delivery requires an operator-supplied relay.
- At-rest encryption depends on the PostgreSQL deployment.
- Assets are stored inside documents (no separate object store yet), so very large media inflate document size; a per-asset limit of 50 MB applies.
- Concurrent edits to the same text box resolve last-writer-wins per element field (not character-level merging).
