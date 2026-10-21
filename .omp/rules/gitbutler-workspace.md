---
name: gitbutler-workspace
description: All work happens on GitButler virtual branches in the base checkout — plain git writes forbidden; `but` replaces git add/commit/checkout/push
alwaysApply: true
---

## GitButler Workspace - MANDATORY

All feature, bugfix, docs, and PR work happens on **GitButler virtual branches** in the base checkout `/Users/woss/projects/woss/exiftool-ts` (workspace mode: HEAD on `gitbutler/workspace`, target `origin/main`). `main` is never checked out locally.

- **NO PLAIN GIT WRITES. EVER.** `git add`/`git commit`/`git switch`/`git checkout`/`git merge`/`git rebase`/`git stash`/`git cherry-pick`/`git push`/`git branch -D` are FORBIDDEN — they corrupt GitButler state and kick the checkout out of workspace mode. Git is for inspection only: `git status`, `git log`, `git diff`, `git show`, `git blame`.
- **All git writes go through `but`.** Full contract: `but --help`; branch/commit/hunk IDs come from `but status` / `but diff` (first token on each line).
- **Session start**: `but pull` — rebases applied lanes onto the target, cleans branches already merged upstream.
- **One lane per feature.** `but status` first — extend an existing lane instead of opening a duplicate. New lane: `but branch new <name>`. Branch names: `feat/<topic>`, `fix/<topic>`, `chore/<topic>`, `docs/<topic>` — NEVER anything matching `gitbutler*` (reserved namespace).
- **Commit discipline**: `but commit -b <branch> -m "…" <ids>` — file IDs from `but diff`. NEVER a no-ID commit while anything else is dirty: it steals the entire dirty tree. `-b` is mandatory even when committing solo (stacked branches share one dirty pool; untargeted commits land on the top branch). `but absorb` folds follow-up fixes into the right commit.
- **Shared dirty pool**: uncommitted edits are lane-agnostic (`zz`) and get assigned to a lane only at commit time. A file dirty for lane A must be committed or discarded before lane B touches it. Already-committed cross-lane changes merge in the working dir; conflicts surface as `{conflicted}` → `but resolve`, oldest first.
- **Simultaneous edits**: two agents writing the same file at once trample bytes at the filesystem level — GitButler cannot prevent it and `but undo` will not recover the lost write. Parallel tasks MUST be file-disjoint. `but oplog snapshot -m "…"` before risky multi-file operations.
- **Standing grant** (no per-action permission needed): `but commit`, `but push` (push = WIP backup; upstream requires PRs anyway), `but branch new`, `but pull`.
- **Integration**: `but push <branch>`, then `gh pr create` → PR merges (squash). Branch protection rejects direct pushes to `main` — never attempt them. **Landing/merging a PR NEVER happens without the user's explicit go in the current conversation.** `gh pr merge --squash --delete-branch` — always delete the head branch on merge.
- **After a PR merges**: `but pull` integrates the squash commit into the workspace base and removes the integrated lane.
- **Recovery**: `but undo` reverts the last operation; `but oplog restore <snapshot>` for earlier states — never while other lanes have in-flight commits (it rolls back THEIR commits too).
- **Violating this rule** (e.g. plain `git switch` off the workspace) leaves GitButler mode with hooks torn down: restore with `git switch gitbutler/workspace`, delete the stray local branch, then `but pull`.
