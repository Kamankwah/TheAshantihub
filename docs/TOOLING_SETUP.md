# Claude Code Tooling Setup — Agents, Skills, Plugins, MCPs

**Status:** Plugin/agent/MCP config files listed here have been created in this pass (see §5 "What's actually configured now"). Real API keys/tokens still need to be filled in by the user — everything ships with placeholders.

## 1. Plugins

Already enabled (`.claude/settings.json` / `.claude/settings.local.json`, confirmed present before this pass): `frontend-design`, `github`, `code-review`, `superpowers`, `playwright`, `skill-creator` — all `@claude-plugins-official`. These cover design guidance, GitHub operations, code review, the Superpowers skill library, browser automation (useful once there's a real app to E2E-test), and skill authoring. No gaps here for now.

**Added in this pass:** `figma@claude-plugins-official` — OAuth-based, no API key needed. Install:

```
claude plugin install figma@claude-plugins-official
```

After install, restart Claude Code, run `/plugin`, select `figma` under Installed, press Enter to authorize, approve access in the browser that opens, then confirm with `/mcp`. **This auth step is interactive and must be run by the user** — it isn't something that can be scripted from inside a session.

## 2. MCP servers (`.mcp.json`, repo root — new file)

| Server | Purpose | Key needed? |
| --- | --- | --- |
| `magic` (21st.dev) | UI component generation via the `/ui` command — useful for the Hero/Navbar work in `docs/FRONTEND_MODERNIZATION.md` | Yes — `API_KEY`, get one at the 21st.dev Magic Console |
| `postgres` (`mcp-server-pg`) | Schema introspection/query access once the Phase 1 backend provisions a real database | Yes — a connection string, doesn't exist until Phase 1 backend work provisions Postgres |
| `semgrep` | Static analysis / security vulnerability scanning — relevant to the Hubtel integration's security checklist (`docs/HUBTEL_INTEGRATION.md` §8) | No |

`.mcp.json` has been created with `magic` and `postgres` using placeholder values (`YOUR_21ST_DEV_API_KEY_HERE`, a placeholder connection string) and `semgrep` fully configured since it needs no credentials. Fill in the two placeholders when the corresponding credentials exist; `postgres`'s placeholder specifically **cannot be filled in until the Phase 1 backend provisions a database** — don't invent a connection string before then.

Verify with `claude mcp list` after filling in real credentials — it should show all three servers.

**Note on the deprecated official Postgres MCP:** the older `@modelcontextprotocol/server-postgres` package is deprecated (had a SQL-injection CVE) — this setup deliberately uses `mcp-server-pg` instead, which supports parameterized queries and read-only enforcement. Don't substitute the deprecated package even if it shows up first in search results.

## 3. Custom project subagents (`.claude/agents/`, new files)

Four project-scoped subagents were added, each tied to one of the spec docs above so a session can be handed a narrow, well-contextualized task instead of re-deriving the whole project each time:

| Agent | Scope | Spec doc |
| --- | --- | --- |
| `frontend-engineer.md` | React 19, this repo's inline-style/`C`-palette convention, the Hero/Navbar/componentization work | `docs/FRONTEND_MODERNIZATION.md`, `docs/PWA_STAFF_DASHBOARD.md` |
| `backend-architect.md` | Django/DRF/Postgres Phase 1 backend build | `docs/PROJECT_SCOPE.md` §3, §5 |
| `payments-integration-engineer.md` | Hubtel/MoMo integration, webhook security | `docs/HUBTEL_INTEGRATION.md` |
| `mobile-engineer.md` | React Native/Expo mobile app | `docs/MOBILE_APP_SCOPE.md` |

These are plain Markdown files (frontmatter: `name`, `description`, `tools`) following Claude Code's standard subagent format — invoke them via the `Agent` tool by name once a session is ready to act on a given spec.

## 4. Skills

No new skills were authored in this pass. **Recommended follow-up** (not done here — `skill-creator` is interactive/generative, out of scope for a docs-only pass): use the already-enabled `skill-creator` plugin to author one project skill, e.g. `ashantihub-conventions`, capturing:

- The `C` palette and the "reuse `C`, don't hardcode colors" rule (`CLAUDE.md` "Styling" section).
- The WhatsApp-first contact pattern (`handleWA`/`WABtn`, `wa.me` deep links, no in-app contact forms).
- The flag-based pseudo-routing convention (`page` state + boolean early-return "routes").

This would let future sessions apply these conventions automatically instead of re-reading `CLAUDE.md` and re-deriving them from the code each time.

## 5. What's actually configured now (this pass)

- `.mcp.json` — created, `magic`/`postgres` placeholders, `semgrep` fully live.
- `.claude/settings.json` — `figma@claude-plugins-official` added to `enabledPlugins`.
- `.claude/agents/frontend-engineer.md`, `backend-architect.md`, `payments-integration-engineer.md`, `mobile-engineer.md` — created.

## 6. What the user still needs to do

- Run `claude plugin install figma@claude-plugins-official` and complete the interactive OAuth step (§1).
- Get a 21st.dev Magic API key and replace the placeholder in `.mcp.json`.
- Once Phase 1 backend work provisions Postgres, replace the `postgres` placeholder connection string in `.mcp.json`.
- Optionally author the `ashantihub-conventions` project skill via `skill-creator` (§4).
