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
- **版本更新说明必须简短明确且无专业术语**：用户明确规则——后续所有的版本更新说明与更新日志，在用户前端界面（应用内更新弹窗、设置更新面板及 `docs/releases/*.md`）展示的内容必须**简短明确，短小精悍，直奔主题，严禁长篇大论**；提炼为 2~3 条要点，每条一两句话讲清楚客观改动和体验变化；遵循 `oil-tone` 文风规范，严禁出现 DOM、CSS 类名、FAB、操作坞、微拟物、径向渐变、JNI、API 等晦涩技术黑话；成稿需经 `tone_lint.py` 校验。
- **控件一律优先使用软件自有设计控件**：用户明确规则——现有及今后新增的所有功能，凡需要控件，一律先用 `src/ui/primitives/` 里的自绘控件，严禁直接使用安卓/浏览器原生弹层控件：时间用 `createTimeControl`、日期用 `createDateControl`、日期时间用 `createDateTimeControl`、下拉用 `createSelectControl`（已有 `<select>` 且选项动态变化时用 `enhanceSelect` 就地替换）、数字加减用 `createStepper`、弹层用 `openBottomSheet`、按钮用 `createButton`、分段切换用 `SegmentedControl`；复选框 / 单选 / `role="switch"` 开关直接用原生 input，外观由 `primitives.css` 全局统一，不要再写 `accent-color` 或页面级私有样式。现有控件不满足需求时，先扩展 primitives 再使用，不要在页面里另起一套。
- **Web 增量热更新机制守则**：
  1. 增量热更新支持基于最低原生 APK versionCode 底座门槛（`DEFAULT_MIN_NATIVE_BUNDLE_VERSION_CODE = 44`）判定，只要本机底座版本 `>= 44` 且存在可用增量包即优先走秒级轻量热更新；绝不可与目标新版本比较以免增量更新被误判失效。
  2. 增量包打包必须保持跨平台确定性（纯 JS 实现、标准化正斜杠路径与固定 UTC 2000-01-01 时间戳），严禁调用依赖操作系统环境的外部压缩命令（如系统 `tar`），以防止 SHA-256 哈希漂移导致客户端验签拦截。
  3. 软件更新界面必须保持“一键秒级更新”与“下载完整包”双通道，并在增量更新异常时自动切换至完整包下载，防止用户更新受阻。
- **应用更新与系统通知纯轻提醒守则**：
  1. 严格区分「业务强提醒（用药闹钟）」与「系统轻提醒（版本更新/系统消息）」，严禁将系统或版本更新接入高优先级闹钟通道（`importance: 5`、全屏横幅、响铃或振动）。
  2. 系统更新类通知必须使用独立低优先级静默通道（`importance: 2`），静默无声无振动、不弹出强打扰顶层横幅，且严禁附加「已服用/跳过」等用药业务操作按钮。
  3. 前台活跃免打扰：当应用处于前台运行状态（`document.visibilityState === 'visible'`）时，严禁向系统发起外部推送横幅打扰用户，仅允许分发更新事件静默刷新界面小红点或状态徽标。
  4. 网页端更新通知必须设置 `silent: true`、`requireInteraction: false` 与空操作集（`actions: []`）。
- **移动端界面排版与交互设计准则**：
  1. **标签徽章防折行**：所有时段标签、状态胶囊必须声明 `white-space: nowrap; flex-shrink: 0; min-width: max-content;`，杜绝小屏手机上中文字符被挤压竖排断行（如 `早\n上`）。
  2. **列向容器子按钮尺寸防御**：列向弹性容器中的按钮子项必须显式限定 `flex: 0 0 auto; min-block-size: var(--tap);`，防止意外继承行内伸缩基准导致纵向高度异常拉伸。
  3. **移动端向导步进条**：移动端多步骤表单避免使用包含全部文字的横向圆圈连线步骤条，统一采用「单行居中步骤标题 + 极细平滑分段指示条」的极简进度条风格。
  4. **双列网格卡片与轻量选中态**：批量管理等双列密集网格卡片避免划分独立的左侧复选框列，优先使用居中垂直流布局充分利用卡片空间；卡片选中态统一采用纯紫色高亮轮廓（`box-shadow: 0 0 0 2px var(--color-primary)`），严禁使用突兀对勾与整卡实心底色填充。
- **彻底下线液态玻璃与现代实色微质感守则**：
  用户明确规则——全站及 AI 助手模块彻底下线液态玻璃（Liquid Glass），严禁使用大面积 `backdrop-filter: blur(...)`、透镜位移滤镜、SVG 噪点遮罩或厚重半透明叠加层。统一采用纯净实色微质感（`var(--color-surface-solid)`），搭配 1px 物理微边框（`var(--color-border)`）与浅层微阴影（`var(--shadow-md)`），根绝 Android 低端机长对话重绘掉帧与卡顿。
- **AI 助手结构化卡片与原位操作契约**：
  1. **用药安排卡**：待服药品右侧必须内嵌原位「已服」微型打卡按钮（`.ai-item-take-btn`），点击后原地切为已服态、自动关闭系统对应推送通知并触发 5 秒可撤销居中 Toast，严禁退化为仅支持外部页面跳转的只读卡片。
  2. **服药统计卡**：严格遵循 oil-ui 减法与主角突出规范，核心展示大数字达成率（如 `82% 良好`），下方搭配单行紧凑横向多段色彩条（已服 / 漏服 / 跳过），彻底淘汰死板拥挤的双列灰网格。
  3. **药品库存卡与搜索参考卡**：状态胶囊一律声明防折行（`white-space: nowrap; flex-shrink: 0; min-width: max-content;`）；搜索引用采用轻量流式小胶囊，严禁嵌套深层原生列表。


