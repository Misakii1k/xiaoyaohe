# Multi-Tool Worktree Protocol

## Purpose

The user frequently switches among coding assistants. Each assistant has a long-lived Git worktree so uncommitted changes from one tool cannot silently mix with another tool's changes. All worktrees share one Git history and object store.

## Directory And Branch Map

| Use | Directory | Branch |
|---|---|---|
| Integration | `C:\Users\87850\Desktop\日常工具箱手机端网页端\medbox` | `main` |
| Claude | `C:\Users\87850\Desktop\日常工具箱手机端网页端\worktrees\medbox-claude` | `workspace/claude` |
| GPT/Codex | `C:\Users\87850\Desktop\日常工具箱手机端网页端\worktrees\medbox-gpt` | `workspace/gpt` |
| Grok | `C:\Users\87850\Desktop\日常工具箱手机端网页端\worktrees\medbox-grok` | `workspace/grok` |
| Trae/Qoder | `C:\Users\87850\Desktop\日常工具箱手机端网页端\worktrees\medbox-trae-qoder` | `workspace/trae-qoder` |

Open the matching directory in each coding application. Do not point multiple applications at the same directory.

## Start Checklist

```powershell
git status --short --branch
git log -5 --oneline
git worktree list
```

Then read:

1. `AGENTS.md`
2. `docs/handoffs/CURRENT.md`
3. The active tool's file in `docs/handoffs/`

If the directory, branch, or handoff does not match, do not edit until the mismatch is understood.

Each worktree intentionally has its own ignored `node_modules/` and local `.env`. On first use in a new worktree, run `npm ci`. Create local secrets from `.env.example` only when needed; never copy secrets into a tracked file. Do not share one writable `node_modules/` directory between concurrently running tools.

To inspect every workspace at once from the integration repository:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/worktree-status.ps1
```

## End Checklist

1. Run verification proportional to the change.
2. Update the active tool handoff from `docs/handoffs/TEMPLATE.md`.
3. Confirm `git diff` and `git diff --cached` contain only intended changes.
4. Commit the coherent work on the tool branch.
5. Leave generated output and secrets untracked.

## Integrating Into Main

From the integration worktree:

```powershell
git status --short --branch
git merge --no-ff workspace/<tool>
npm run typecheck
npm test
```

Run broader browser/Android gates when affected. After integration, enter each tool worktree and merge `main` into its branch before starting new feature work. Do not force-push or rewrite shared branch history.

## Files And Artifacts

- `release/` APK/checksum files are local deliverables and ignored unless a release policy explicitly changes.
- `design/**/*.png` uses Git LFS so original assets are shared without inflating normal Git objects.
- `.trae/specs/` is tracked historical context; other `.trae/` local metadata stays ignored.
- `.env` and tool caches remain local and untracked. The App-only build has no tracked environment template.
- Screenshots and Playwright traces stay under ignored output folders.

## Version And Packaging Policy

- Preserve Git history and `.git`.
- Product changes must consider the app version and packaging before handoff.
- Large product changes normally increment the version and create a new package.
- Small or repository-only changes do not automatically change the product version; document why no product build was needed.
