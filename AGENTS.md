# exiftool Agent Instructions

**Agent-agnostic** — works with mp, opencode, or any compatible agent.

---

## Primary Tools

### CodeGraph — Code Exploration (MUST USE FIRST)
- **Tool**: `codegraph_explore` (via `xd://mcp__codegraph_explore`)
- **Repo**: https://github.com/colbymchenry/codegraph
- **Rule**: Use for ALL structural questions — "how does X work", "where is Y defined", "what calls Z", "trace flow from A to B"
- **Do NOT grep/read first** — CodeGraph returns verbatim line-numbered source + call paths + blast radius in one call
- **Trust results** — AST-parsed, no re-verification with grep needed
- **Index lag**: ~500ms behind writes; don't re-query immediately after editing

**When to use CodeGraph vs native tools:**
| Task | Tool |
|---|---|
| How does X work / architecture / trace flow | `codegraph_explore` |
| Find symbol definition | `codegraph_explore` (name it) |
| What calls function Y | `codegraph_explore` (name Y) |
| What would break if I change Z | `codegraph_explore` (name Z) |
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
2. **Research** → `codegraph_explore` FIRST; reuse patterns; `lsp references` before exported-symbol changes
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

- **codegraph** — `codegraph_explore` (primary exploration)
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

---

## Project-Specific

This is **exiftool-ts** — TypeScript wrapper for ExifTool.
- Check `package.json` for scripts, deps, version
- Check `tsconfig.json` for build config
- Tests: `bun test` (bun:test framework)
- Lint/format: Check for `biome.json`, `eslint.config.js`, `prettier.config.js`

---

## Quick Reference

```
codegraph_explore "how does X work"     → architecture, flow, source
codegraph_explore "find symbol Y"       → definition + callers + blast radius
codegraph_explore "trace A to B"        → call path with dynamic hops
rtk gain                                → token savings
rtk discover                            → missed opportunities
caveman mode                            → ALWAYS ON
lsp rename / references / code_actions  → symbol-aware refactors
```