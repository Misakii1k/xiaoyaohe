# Multi-Tool Repository Rules

This repository is edited from Claude, GPT/Codex, Grok, Trae, and Qoder. Chat history is not the source of truth. Git history and `docs/handoffs/` are.

## Before Editing

1. Confirm the absolute working directory and current branch.
2. Run `git status --short --branch`, `git log -5 --oneline`, and `git worktree list`.
3. Read `docs/worktrees/README.md`, `docs/handoffs/CURRENT.md`, and the handoff file for the active tool.
4. If the branch or directory does not match the tool mapping, stop and report it before changing files.
5. Treat unfamiliar changes as another tool's or the user's work. Preserve them.

## Workspace Mapping

| Tool | Branch | Handoff |
|---|---|---|
| Claude | `workspace/claude` | `docs/handoffs/claude.md` |
| GPT/Codex | `workspace/gpt` | `docs/handoffs/gpt.md` |
| Grok | `workspace/grok` | `docs/handoffs/grok.md` |
| Trae/Qoder | `workspace/trae-qoder` | `docs/handoffs/trae-qoder.md` |
| Integration only | `main` | `docs/handoffs/CURRENT.md` |

## Safety Rules

- Never delete `.git`, use destructive reset/checkout/clean commands, or overwrite unknown changes.
- Never use the same worktree concurrently from two tools.
- Feature work belongs on the mapped tool branch. Keep `main` clean and use it only for deliberate integration, releases, or an explicitly requested emergency fix.
- Commit coherent, tested changes before switching tools. Do not leave important context only in a chat.
- Before ending, update the tool handoff with scope, files, tests, remaining work, and the latest commit.
- Merge tested commits into `main`; then merge `main` back into every long-lived tool branch before new work begins.
- `release/` APK/checksum files, browser output, logs, caches, and secrets stay untracked. Design PNG sources use Git LFS.
- Preserve the project's existing versioning and packaging policy recorded in `docs/worktrees/README.md`.
- Release and in-app update SOP is documented in `docs/releases/GUIDE.md` and automated by skill `medbox-release`. A version bump requires a full GitHub Release with APK and Web Bundle attachments via `gh release create`, not just a bare git tag. After APK generation, run `node scripts/gen-version.mjs` before tests, and verify online endpoints via `node scripts/check-release-endpoints.mjs`.
- **严禁向用户个人桌面复制任何构建产物**：构建产物（APK、Web 增量包、校验和文件）一律且仅保存在 `release/` 目录与 GitHub Releases 云端，严禁执行任何复制至用户个人电脑桌面（Desktop）的操作，避免污染用户个人工作空间。
- **每次向云端推送时必须将版本号向上加一**：每次 push 提交到云端远程仓库前，必须同步递增版本号与 Android `versionCode`（如 1.0.6/41 -> 1.0.7/42），同步 `package.json`、`package-lock.json`、`android/app/build.gradle`，生成对应 `docs/releases/X.Y.Z.md` 发布记录，并同步 `tests/apkUpdateVerification.test.ts` 中的 mock 候选版本。
- **版本更新说明必须使用 oil-tone 并减少专业术语**：用户明确规则——后期的所有版本更新介绍与说明（`docs/releases/*.md` 及应用内更新弹窗文案）必须遵循 `oil-tone` 文风规范，**减少专业术语**。面向普通用户平铺直叙，陈述客观改动和实际体验变化，严禁出现 DOM、CSS 类名、FAB、操作坞、微拟物、径向渐变、JNI、API 等晦涩技术黑话；成稿需经 `tone_lint.py` 校验。


