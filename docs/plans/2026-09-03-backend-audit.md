# 后端全面检查（Backend Audit）实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 对小药盒（medbox）全部「后端面」做一次可复核的全面检查：独立 Node 服务（腾讯云 ASR 代理）、应用内 LAN 服务（局域网同步 + APK 分发）、客户端出站 API 与密钥处理、已退役云同步残留、开发期网络暴露，并产出审计记录与必要的修复。

**Architecture:** 本项目是 Capacitor 包装的本地优先 PWA，没有自建业务服务器。所谓「后端」由五块组成：① `server/tencent-asr-proxy.mjs`（0.9.7 起客户端已移除语音功能，但该文件仍存在于 `main`/`origin/main`，工作分支 `workspace/claude` 已删除——需先做处置决策）；② 应用内 LAN 协议 `src/sync/lan/*` + 原生 APK 分发服务（TCP 38473，`android/.../lansync/ApkDistributionPlugin.java`、`ApkIntegrity.java`）；③ 客户端直连第三方 API（LLM 服务商默认 `https://apihub.agnes-ai.com/v1`、`https://mcp.exa.ai/mcp`，密钥走 `@aparajita/capacitor-secure-storage`）；④ 退役云同步清理代码 `src/sync/retired*.ts`；⑤ dev/preview 的局域网暴露（`vite.config.ts` `host: true`）。

**Tech Stack:** Node 22（`.mjs`，无框架，`node:http`）、TypeScript + Vite + Vitest、Capacitor 8 + Java（Android 原生插件）、curl 黑盒探测。

---

## 基线说明（2026-09-03 工作区整理，先于本审计完成）

- 0.9.11 的全部未提交改动（119 个文件：UI 重构、Gemini 头像库、去代码化文案、versionCode 30、图标/闪屏等）已在本日分批提交到 `workspace/claude`，工作区恢复干净。验证门：`tsc --noEmit` 0 错误、vitest 429/429 全绿。
- **整理时发现并修复一个真实缺陷**：0.9.11 的 `gen-icons.mjs` 曾改用 `design/brand/master/app-icon-foreground.png` 作自适应前景层，但该素材背景渐变未抠除（外环 100% 不透明），导致 `tests/iconAssets.test.ts` 安全区断言失败，且回退了 0.9.10「66/108 重裁防文字被遮罩裁切」的修复。已将 `adaptiveForeground` 还原为 HEAD 的透明画布合成逻辑并重新生成全部 32 个图标资源。**注意：已构建的 `release/xiaoyaohe-0.9.11-android-release.apk` 仍含旧图标，下次发版重建时才会带上修复**。「主体抠图式自适应图标」作为后续优化项（需先真正抠出透明底素材）。

## 全局约束（执行前必读）

- 工作目录 `medbox/`，当前分支 `workspace/claude`（Claude 专属分支，勿切到 main 改文件）。`git worktree list` 确认无其他 worktree 争用。
- 工作区基线为 0.9.11（已提交、干净）。审计过程中若再出现脏文件，先 `git status --short` 核对来源再动。
- `medbox/.env` 含 AI 密钥：**任何命令输出、任何提交、任何报告里都不得打印其内容**。只允许 `grep -o` 变量名（见 Task 7 命令写法）。
- `release/` 产物与 secrets 不入库；设计 PNG 走 Git LFS。
- 每个 Task 结束都提交一次，提交信息前缀 `audit:` 或 `fix:`。

---

### Task 0: 基线确认（只读，不改文件）

**Files:**
- Read: `AGENTS.md`、`docs/handoffs/CURRENT.md`、`docs/handoffs/claude.md`

**Step 1: 记录分支与脏文件清单**

```bash
git branch --show-current
git status --short > /tmp/backend-audit-baseline.txt
wc -l /tmp/backend-audit-baseline.txt
```

Expected: 分支 `workspace/claude`；`git status --short` 为空（0.9.11 基线已提交）。若出现意外改动，停下询问用户。

**Step 2: 跑绿色基线**

```bash
npm run typecheck
npm run test
```

Expected: typecheck 0 错误；vitest 全绿（0.9.11 交接记录为 75 套件 / 429 测试）。若有失败，先记录为基线缺陷，写入最终报告，不带病审计。

**Step 3: 不提交**（本 Task 无文件改动）。

---

### Task 1: server/ 目录状态核对与处置决策

**Files:**
- Compare: `main:server/tencent-asr-proxy.mjs`、`main:server/README.md`（工作分支上不存在）
- Write: `docs/handoffs/claude.md`（追加决策记录）

**Step 1: 确认三处状态**

```bash
git ls-tree main server/
git ls-tree origin/main server/
git ls-files server/
git log --oneline -1 --diff-filter=D -- server/
```

Expected: `main` 与 `origin/main` 各有 2 个文件；`git ls-files server/` 为空；删除发生在 `abb06f2`（0.9.7 发版，随语音功能整体移除）。

**Step 2: 确认本地 main 已过期**

```bash
git log --oneline -1 main
git log --oneline -1 origin/main
```

Expected: 均为 `0a4b3a2`（0.9.6），而 `CURRENT.md` 声称 main 已到 0.9.11 合并——说明本地与远端跟踪引用都旧。**执行 `git fetch origin`（需要网络/凭据，失败则跳过并记录）**，fetch 成功后重跑上面两条命令，以最新 `origin/main` 为准。

**Step 3: 向用户提问（阻塞点，必须等回答）**

> 「腾讯云语音代理（server/tencent-asr-proxy.mjs）客户端调用已在 0.9.7 移除，但 main 分支仍保留该文件。你的服务器上是否还部署着这个代理（VITE_ASR_PROXY_URL 指向的服务）？」

- 回答「已下线/没有」→ 记为 **决策 A：彻底退役**。后续 Task 2/3 降级为「仅存档性检查」，并在 main 集成时删除 `server/`（本分支不动 main，只把决策写进 handoff，由集成流程执行）。
- 回答「还在跑」→ 记为 **决策 B：保留并完整审计**。继续 Task 2、3 全部步骤。

**Step 4: 写决策进 handoff 并提交**

在 `docs/handoffs/claude.md` 追加一节「2026-09-03 后端审计：server/ 处置决策」，写明 A/B 与依据。

```bash
git add docs/handoffs/claude.md
git commit -m "audit: record ASR proxy disposition decision (A retire / B keep)"
```

---

### Task 2: ASR 代理黑盒探测（决策 B 必做；决策 A 可跳过）

**Files:**
- Create（临时，不入库）: `/tmp/asr-audit/proxy.mjs`（从 main 提取）

**Step 1: 提取并启动（无密钥态）**

```bash
mkdir -p /tmp/asr-audit
git show main:server/tencent-asr-proxy.mjs > /tmp/asr-audit/proxy.mjs
cd /tmp/asr-audit && PORT=8787 node proxy.mjs &
```

Expected: stderr 输出 `Tencent ASR proxy listening on http://127.0.0.1:8787`，并警告未配置 ALLOWED_ORIGINS（默认只放行回环）。

**Step 2: 逐条探测（每条独立验证）**

```bash
# 1) 未知路径 → 404
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:8787/nope
# 2) 非白名单来源 → 403
curl -s -H "Origin: https://evil.example" -X POST http://127.0.0.1:8787/api/speech/tencent
# 3) 预检 → 204
curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS http://127.0.0.1:8787/api/speech/tencent
# 4) 无密钥的正常请求 → 503 PROXY_NOT_CONFIGURED
curl -s -X POST http://127.0.0.1:8787/api/speech/tencent -H 'Content-Type: application/json' -d '{"format":"wav","audioBase64":"AAA="}'
# 5) 超限包体 → 413（>4.3MB 请求体）
head -c 5000000 /dev/zero | tr '\0' 'A' > /tmp/asr-audit/big.txt
curl -s -X POST http://127.0.0.1:8787/api/speech/tencent -H 'Content-Type: application/json' --data-binary @/tmp/asr-audit/big.txt -o /dev/null -w "%{http_code}\n"
# 6) 限流：同来源第 31 次 → 429
for i in $(seq 1 31); do curl -s -o /dev/null -w "%{http_code} " -X POST http://127.0.0.1:8787/api/speech/tencent -d '{}'; done; echo
```

Expected: 依次 `404`、`403 ORIGIN_NOT_ALLOWED`、`204`、`503 PROXY_NOT_CONFIGURED`、`413`、末尾出现 `429`。任何一条不符 = 缺陷，进入 Step 3 修复流程。

**Step 3（仅当有缺陷）: TDD 修复**

代理目前**没有任何测试文件**。先建 `server/tencent-asr-proxy.test.ts`（vitest，直接 import `createTencentAsrProxy` + 伪造 `http.IncomingMessage/ServerResponse` 或用 `node:http` 起临时服务），为失败的那条探测写断言 → 跑 `npx vitest run server/` 确认红 → 修 `proxy.mjs` → 绿 → 提交 `fix(asr-proxy): <缺陷>`。

**Step 4: 收尾**

```bash
kill %1   # 停掉探测进程
```

---

### Task 3: ASR 代理白盒安全评审（决策 B 必做）

**Files:**
- Read: `/tmp/asr-audit/proxy.mjs`（全文 270 行）
- Write: 评审结论进 `docs/handoffs/claude.md`

**Step 1: 按清单逐项核对，每项在报告里标 ✅/⚠️/❌ + 行号证据**

1. 凭据只从环境变量读取，不落日志（搜 `console` 全部调用点）。
2. 错误对外只暴露 `publicTencentMessage` 脱敏文案，不回显腾讯原始错误。
3. 请求体上限 `MAX_BODY_BYTES=4.3MB`、音频上限 3MB、时长 60.5s，且**先验 WAV 魔数再计费**。
4. 限流按来源 IP（`clientKey`），`MAX_TRACKED_ADDRESSES=5000` 有清理，防表膨胀 DoS；确认清理是「全清」还是 LRU——全清会被用来重置配额，标注为已知弱点。
5. CORS：无 `Origin` 头的 curl 直连不受 CORS 约束（代码注释已承认），真正防线是限流——确认部署文档要求前置 HTTPS + 反代限流。
6. TC3-HMAC-SHA256 签名实现与腾讯规范一致（canonical headers 顺序、`x-tc-action` 小写）。
7. 默认绑定 `127.0.0.1`，公网暴露必须走反代——README 是否写清。
8. `audioBase64` 解码前是否限制字符串长度（base64 膨胀 4/3，4.3MB 请求体 → 最多 ~3.2MB Buffer，与 3MB 音频上限的余量是否够，防解码 OOM）。

**Step 2: 结论提交**

```bash
git add docs/handoffs/claude.md
git commit -m "audit: ASR proxy white-box review findings"
```

---

### Task 4: 客户端出站端点与密钥处理审计

**Files:**
- Read: `src/ai/llmConfig.ts`、`src/ai/llmRouting.ts`、`src/ai/assistant.ts`、`src/ai/exaMcp.ts`、`src/ai/secretStore.ts`、`src/main.ts`
- Write: 审计结论进 handoff

**Step 1: 枚举全部出站目标（命令已验证可用）**

```bash
grep -rhoE "https?://[a-zA-Z0-9.-]+" src --include="*.ts" | grep -v test | sort | uniq -c | sort -rn
```

Expected 命中面：`apihub.agnes-ai.com`（默认 LLM）、`mcp.exa.ai`、以及 llmConfig 内置服务商列表（deepseek/openrouter/bigmodel/zhipu/siliconflow/moonshot/dashscope 等）。逐个确认：是「用户主动配置的预置项」还是「代码硬编码自动请求」。

**Step 2: 核对 HTTPS 强制与例外**

`src/ai/llmConfig.ts:177`：`url.protocol !== 'https:' && !(import.meta.env.DEV && local)` → 确认生产构建下 http 端点一律拒绝、DEV 例外仅限回环/局域网。写一条断言测试（若 `validateBaseUrl` 未导出则先导出）：

```ts
// tests/ai/llm-config-https.test.ts
expect(() => assertSafeBaseUrl('http://10.0.0.1/v1')).toThrow(); // 生产语义
```

跑 `npx vitest run tests/ai/llm-config-https.test.ts` 红→实现→绿，提交 `test(ai): pin https-only base url enforcement`。

**Step 3: 密钥落点审计**

- `secretStore.ts`：确认密钥只进 `@aparajita/capacitor-secure-storage`，不落 localStorage；grep 佐证：`grep -rn "localStorage" src/ai/ | grep -i key` 应为空。
- `exaMcp.ts`：确认 Exa 密钥不拼进 URL query（`EXA_MCP_URL` 只有 `?tools=`），只走 header。
- 0.9.7 遗留：腾讯云语音旧密钥仍在 secure storage（release 文档明示「保留不读取」）→ 记入报告，是否清理留给 Task 6 决策。

**Step 4: 产物泄漏检查**

```bash
grep -rloE "sk-[A-Za-z0-9]{16,}|SECRET_ID" dist/ 2>/dev/null | head
```

Expected: 空。若命中，立即停止发布流程并升级为 P0。

**Step 5: 提交结论** `audit: client outbound endpoints & secret handling`

---

### Task 5: LAN 同步协议与原生 APK 分发服务审计

**Files:**
- Read: `src/sync/lan/apkTransport.ts`、`src/sync/lan/crypto.ts`、`session.ts`、`invitation.ts`、`policy.ts`
- Read: `android/app/src/main/java/com/medbox/app/lansync/ApkDistributionPlugin.java`、`ApkIntegrity.java`

**Step 1: 跑既有测试**

```bash
npx vitest run src/sync/lan
```

Expected: 全绿（crypto/session/apkTransport/extras 等）。

**Step 2: 端口与常量一致性**

`apkTransport.ts` 的 `APK_DISTRIBUTION_PORT = 38473` 与 Java 侧常量 grep 比对：`grep -n "38473" android/app/src/main/java -r`。不一致 = 缺陷。

**Step 3: 原生服务白盒清单（每项标 ✅/❌ + 行号）**

1. APK 分发服务是否**无鉴权**对局域网整段开放（设计如此？邀请/pin 机制是否覆盖 APK 通道——注释说「与 LanSync 协议完全解耦」，即 APK 通道可能没有配对认证，重点标注）。
2. 下载后安装前是否强制 `verifyApk`（包名 + versionCode 校验，`ApkIntegrity.java`），拒绝降级安装。
3. 文件路径是否只允许 cacheDir 固定文件名，防路径注入。
4. 服务是否只在用户主动点「分享更新」时启动、离开页面即 `stopServer`。

**Step 4: 结论提交** `audit: LAN sync + APK distribution review findings`

---

### Task 6: 退役后端残留清理验证

**Files:**
- Read: `src/main.ts:42-43,145-146`、`src/sync/retiredCloudStorage.ts`、`retiredWorkStorage.ts`
- Test: `src/sync/retiredCloudStorage.test.ts`、`retiredWorkStorage.test.ts`

**Step 1: 确认清理在启动路径上被调用**（main.ts 已见调用点，跑测试即可）：

```bash
npx vitest run src/sync/retiredCloudStorage.test.ts src/sync/retiredWorkStorage.test.ts
```

Expected: 全绿。

**Step 2（可选修复，需用户点头）: 旧腾讯语音密钥清理**

若用户确认不再需要保留：在 `retiredCloudStorage.ts` 的清理清单里追加 `medbox_` 前缀下的腾讯 ASR 密钥键名，先写失败测试（伪造 secure-storage 断言该键被删除）→ 实现 → 绿 → 提交 `fix(sync): purge legacy tencent ASR keys from secure storage`。若用户要保留（便于回滚版本），只在报告记录现状。

---

### Task 7: 开发期网络暴露与 .env 卫生

**Files:**
- Read: `vite.config.ts:40-43`（`host: true`, port 5173）
- Create: `medbox/.env.example`（当前不存在）

**Step 1: 只看变量名，不看值**

```bash
grep -oE "^[A-Z_]+" .env | sort
```

Expected: 变量名清单（如 `VITE_AGNES_API_KEY` 等）。确认：非 `VITE_` 前缀的变量不会被 vite 注入前端产物（vite 默认行为，记录为 ✅ 即可）。

**Step 2: 创建 `.env.example`（只含键名与占位符）**

```bash
# .env.example —— 复制为 .env 后填写；真实 .env 永不入库
VITE_AGNES_API_BASE=
VITE_AGNES_API_KEY=
```

（以 Step 1 实际变量名清单为准逐行生成，值一律留空。）

**Step 3: 确认 .gitignore 覆盖 `.env`**：`git check-ignore .env` 应输出 `.env`。

**Step 4: 报告记录风险**：`npm run dev` 将含用户密钥会话的页面暴露于局域网 5173 端口，属已知取舍（手机联调需要），建议 handoff 注明「联调完必须 Ctrl-C 关停」。提交 `chore: add .env.example`。

---

### Task 8: 汇总审计报告并交接

**Files:**
- Write: `docs/handoffs/claude.md` 新增「2026-09-03 后端全面审计结论」一节：五个后端面 × 每项 ✅/⚠️/❌ + 证据行号 + 已修项 commit hash + 遗留风险 + server/ 处置决策。

**Step 1: 汇总提交**

```bash
git add docs/handoffs/claude.md
git commit -m "audit: backend comprehensive audit report 2026-09-03"
```

**Step 2: 向用户口头汇报**：TLDR + 需要用户决策的遗留项（main 上 server/ 删除、APK 通道无鉴权是否接受、旧密钥清理）。

---

## 风险与停止条件

- `git fetch` 可能因网络/凭据失败（本会话已观察到挂起）：失败即跳过，用本地引用并在报告标注「origin 引用可能过期」。
- 任何步骤发现 `dist/`/APK 含密钥 → 停止一切后续任务，立即报告用户。
- 脏工作区（0.9.11 产物）全程不碰；若某修复必须改 `android/` 下文件，先与用户确认该文件当前改动内容。
