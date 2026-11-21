# exiftool Agent Instructions

**Agent-agnostic** — works with mp, opencode, or any compatible agent.

---

## Primary Tools

### Code Intelligence — code-review-graph MCP (MUST USE FIRST)
- **Tool**: `code-review-graph` MCP (stdio, `.omp/mcp.json`) — persistent knowledge graph of this repo
- **Rule**: Use for ALL structural questions — "how does X work", "where is Y defined", "what calls Z", "trace flow from A to B"
- **Do NOT grep/read first** — graph tools return callers/impact/tests with line numbers in one call
- **Start every code task**: `get_minimal_context(task=…)`; keep `detail_level="minimal"`, escalate only if insufficient
- **Common tools**: `query_graph` (callers_of / callees_of / imports_of / tests_for), `get_impact_radius`, `semantic_search_nodes`, `detect_changes`
- **Staleness**: graph updates only on build/update — run `code-review-graph update --brief` after editing, `code-review-graph build` after big merges (~5s; `.code-review-graph/` DB is gitignored)
- **Skills**: `.omp/skills/code-review-graph/` (explore, review changes, debug, refactor)

### Write-parity specs (metadata writing)

- **Spec home**: `docs/write-parity/` — `matrix.json` (generated contract) + `specs/*.md` (per-serializer invariants). `WRITE_PLAN.md` is the requirement source, not the contract.
- **Skill**: `skill://write-parity` — planner/implementer/reviewer roles + differential gates vs vendored ExifTool 13.64. Load before any write-parity lane.

**When to use code-review-graph vs native tools:**
| Task | Tool |
|---|---|
| How does X work / architecture / trace flow | `query_graph` / `get_architecture_overview` |
| Find symbol definition | `semantic_search_nodes` (name it) |
| What calls function Y | `query_graph` pattern=`callers_of` |
| What would break if I change Z | `get_impact_radius` / `detect_changes` |
| Test coverage of a function | `query_graph` pattern=`tests_for` |
| Literal text search (strings, comments, logs) | `grep` / `read` |
| Configs, docs, non-indexed files | `read` / `glob` |

### RTK — Token-Optimized Terminal (MUST USE)
- **Binary**: `rtk` (Rust Token Killer)
- **Repo**: https://github.com/reachingforthejack/rtk
- **Hook**: All commands auto-rewritten via Claude Code hook (transparent)
- **Meta commands**:
  ```bash
  rtk gain              # Token savings analytics
  rtk gain --history    # Command usage history with savings
  rtk discover          # Analyze Claude Code history for missed opportunities
  rtk proxy <cmd>       # Execute raw command without filtering
  ```
- **Verify**: `rtk --version` should show version; `rtk gain` must work
- **Collision warning**: If `rtk gain` fails, you may have Rust Type Kit installed instead

---

## Caveman Mode — ALWAYS ON
- **Protocol**: Ultra-compressed communication (65% token reduction measured)
- **Intensity**: Full (default) — speaks like caveman, keeps full technical accuracy
- **Auto-triggers**: "caveman mode", "talk like caveman", "use caveman", "less tokens", "be brief", "/caveman"
- **Applies to**: All output, commit messages, code reviews, help text
- **Do NOT disable** unless explicitly asked

---

## Core Engineering Rules

### Correctness First
- Correctness → maintainability (6 months out) → performance
- Delete weightless code; refuse needless abstractions; prefer boring
- NEVER avoidably allocate, copy, or compute in hot paths

### GitButler Workspace — MANDATORY

All git writes go through `but` (GitButler virtual branches) — plain git writes (`git add`/`commit`/`switch`/`checkout`/`push`/`merge`) are FORBIDDEN and corrupt the workspace. Git is inspection-only. Session starts with `but pull`; one lane per feature (`but branch new feat|fix|chore|docs/<topic>`, never `gitbutler*`); commits via `but commit -b <branch> -m "…" <ids>` with IDs from `but diff`. Committing and pushing via `but` is always allowed; merging a PR NEVER happens without the user's explicit go. Full contract: `.omp/rules/gitbutler-workspace.md`.

### Evidence-Based
- User-reported state (errors, failures, observations) = ground truth
- NEVER re-run checks to confirm what user already reported
- Code/tool/test/doc claims MUST be grounded; unobserved = `[INFERENCE]`

### Clean Cutover
- Migrate EVERY caller; remove obsolete code/comments/aliases/re-exports/deprecated paths
- No shims, no aliases, no deprecated paths left behind

### Verification Required
- **Bug fix**: Reproduce → fix → confirm reproduction no longer triggers
- **UI change**: Drive actual surface (browser for web, launch for CLI/TUI)
- **Permanent feature**: Existing changed-contract tests pass
- **Experiment/one-off**: No cleanup tests/docs needed

---

## Workflow

1. **Scope** → Read relevant context; plan before multi-file work
2. **Research** → `code-review-graph` MCP FIRST (`get_minimal_context` / `query_graph`); reuse patterns; `lsp references` before exported-symbol changes
3. **Decompose** → Todo init with first reads/edits (never solo todo turn)
4. **Implement** → Fix source, not symptoms; clean cutover
5. **Verify** → Run thing, observe result; behavioral tests for contracts
6. **Cleanup** → Tests, docs, changelog, scaffold removal (after smoke test passes)

---

## Tool Policy

| Category | Tool | NOT |
|---|---|---|
| File read | `read` | `cat`, `less` |
| Surgical edit | `edit` | `sed`, `awk` |
| Create/overwrite | `write` | `echo >` |
| Code intelligence | `lsp` (rename, refs, def, actions) | `grep`/`sed` renames |
| Regex search | `grep` | shell `grep`/`rg` |
| Glob/find | `glob` | `ls`, `find` |
| Bash | Real binaries / short pipelines | Complex scripts → `eval` |
| Codemods | `ast_edit` | Text hacks |
| Image analysis | `inspect_image` | `read` |

**Delegation**: Map unknown code via `task` subagents. Own decomposition. Max 32 concurrent. Real concurrency only.

---

## MCP Servers (Auto-Available)

- **code-review-graph** — persistent code knowledge graph (primary code intelligence; `.omp/mcp.json`)
- **memory** — Persist/retrieve memories across sessions
- **context7** — Current library docs (use for ANY library question)
- **gh_grep** — Real GitHub code examples

---

## Non-Negotiables

- NEVER yield while actionable work remains
- NEVER fabricate output
- NEVER substitute easier problem or solve symptom unless asked
- NEVER ask for tool/repo/file-provided info
- NEVER narrate session limits, token budgets, effort estimates
- NEVER re-audit applied edits or routinely run git for validation
- NEVER push directly to `main` — branch protection enforces this (PRs required, admins included). Branch → PR → merge; release tags only after the merge lands on `main`.

---

## Project-Specific

This is **exiftool-ts** — TypeScript wrapper for ExifTool.
- Check `package.json` for scripts, deps, version
- Check `tsconfig.json` for build config
- Tests: `vitest run` (vitest framework; 564 tests / 40 files). Verify with `node node_modules/vitest/vitest.mjs run` — dev tooling needs Node ≥20 (vitest 4 floor); library `engines` is Node ≥18.
- Lint/format: none configured — do not invent one.

---

## Quick Reference

```
code-review-graph build                → full graph rebuild (~5s; DB gitignored)
code-review-graph update --brief       → incremental reparse of changed files
code-review-graph detect-changes       → risk-scored change impact (read-only)
get_minimal_context(task=…)            → MCP entry point for any code task
query_graph callers_of Y               → callers / blast radius
rtk gain                                → token savings
rtk discover                            → missed opportunities
caveman mode                            → ALWAYS ON
lsp rename / references / code_actions  → symbol-aware refactors
```