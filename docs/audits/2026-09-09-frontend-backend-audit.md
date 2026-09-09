# 前端与后端全面检查 2026-09-09

范围：小药盒（medbox）1.0.0 基线的「后端面」与前端面。分支 `workspace/claude`，起点 commit `de92964`。

本项目没有自建业务服务器，「后端」由五块组成：

| 面 | 位置 |
|---|---|
| ① Cloudflare Pages Functions（私有 GitHub Release 代理） | `functions/api/download.ts`、`releases.ts`、`_shared.ts` |
| ② 发布与更新链路（版本元数据 + 客户端探测下载） | `scripts/gen-version.mjs`、`src/sync/lan/apkTransport.ts` |
| ③ Android 原生局域网同步与 APK 分发（TCP 38473） | `android/app/src/main/java/com/medbox/app/lansync/*.java`、`src/sync/lan/*` |
| ④ 客户端出站第三方 API 与密钥 | `src/ai/*`、`src/sync/lan/extras.ts` |
| ⑤ CI/CD 流水线 | `.github/workflows/*.yml` |

前端面 = `src/**`（160 个文件）、`index.html` CSP、`public/sw.js`、`vite.config.ts`、`capacitor.config.ts`。

---

## 1. 检查方法

只读检查，未修改任何文件（修复在检查结论之后单独提交）：

- 本地门禁：`npm run typecheck`、`npm run test`、`npx playwright test`、`npm run build:web` 相关产物分析。
- 静态检索：`innerHTML`/`eval`/`new Function`、`localStorage` 密钥落点、出站 URL 枚举、`dist/` 密钥扫描、`TODO`/`FIXME`。
- 线上黑盒探测（`curl`，只读 GET）：`https://xiaoyaohe.pages.dev/version.json`、`/api/releases`、`/api/download`、`/release/xiaoyaohe-1.0.0-android-release.apk`、`https://api.github.com/repos/Misakii1k/xiaoyaohe/releases/latest`、`https://misakii1k.github.io/xiaoyaohe/`。
- URL 归一化行为用 `node -e` 本地复现，未对第三方发起攻击性请求。
- `.env` 只读变量名，未打印任何值。

## 2. 基线结果

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run test` | 79 个文件 / 472 项全绿 |
| `npx playwright test` | 第 1 次 exit 1，第 2 次 52/52 全绿 → 存在偶发不稳定 |
| `dist/` 密钥扫描 | 无命中 |
| `innerHTML` / `eval` / `new Function` | `src/**` 零命中 |

## 3. 结论清单

严重度：P0 阻断、P1 安全或功能缺陷、P2 流程与加固、P3 卫生与观察项。

### P0-1 云端更新链路在线上完全不可用

- 线上 `version.json` 的 `downloadUrl` 为 `https://github.com/Misakii1k/xiaoyaohe/releases/download/v1.0.0/xiaoyaohe-1.0.0-android-release.apk`，仓库私有，匿名访问 `api.github.com/.../releases/latest` 返回 **404**。
- `https://xiaoyaohe.pages.dev/release/xiaoyaohe-1.0.0-android-release.apk` 返回 **200 `text/html`**：命中 Pages 的 SPA 兜底，因为 `public/release/` 被 `.gitignore` 的 `release/` 规则忽略，从 git 构建时该目录不存在。
- 线上 `fileSize` 为 `16398223`，即 `scripts/gen-version.mjs` 的硬编码兜底值；真实 1.0.0 APK 为 `32095374` 字节（`release/SHA256SUMS` = `cb86c348…`）。
- 客户端 `downloadUpdate` 会对同一 URL 再套 3 个 ghproxy 前缀重试，对私有资产同样无效。

修复：`gen-version.mjs` 改为输出同源代理直链 `/api/download?tag=v1.0.0`，并写入真实 `fileSize` 与 `sha256`；客户端解析相对直链、校验下载字节数。

### P0-2 专为修 404 而加的 Cloudflare 代理没有配置

- `/api/releases` 与 `/api/download` 均返回 **503 `GITHUB_TOKEN_NOT_CONFIGURED`**。
- 两个 Function 都硬依赖 `env.GITHUB_TOKEN`，该变量未出现在 Pages 项目环境变量里。
- 结果：`checkGithubRelease()` 的首个候选 503，官方 API 与三个镜像对私有仓库 404，GitHub 通道整体失效。

修复：代码侧已就绪，仍需在 Cloudflare Pages 项目配置 `GITHUB_TOKEN`（建议 fine-grained、仅 `Contents: Read`、仅本仓库）。

### P1-3 `tag` 参数路径穿越与查询注入

`tag` 直接拼进 GitHub API 路径，而 WHATWG URL 会归一化点段：

```
tag=../../../../user        -> https://api.github.com/repos/user
tag=x?per_page=1            -> 注入查询串
```

配合 `releases.ts` 的 `Access-Control-Allow-Origin: *`，该端点可被当作「带 token 的 GitHub API 任意路径读取代理」。

修复：`functions/api/_shared.ts` 增加版本号白名单 `/^v?\d{1,4}\.\d{1,4}\.\d{1,4}(?:[-+][0-9A-Za-z.-]{1,32})?$/`，非法一律 400，并在构造 URL 后断言仍位于 `/releases/tags/` 之下。

### P1-4 代理是开放 CORS 的无限流中继

`Access-Control-Allow-Origin: *` 且无来源校验与限流，任意站点可借它耗尽 PAT 的 5000 次/小时配额，连带拖垮自家更新检查。

修复：CORS 改为来源白名单（`https://xiaoyaohe.pages.dev`、`https://localhost`、`capacitor://localhost`）并加 `Vary: Origin`；缓存改 `public, max-age=60, s-maxage=300`。限流建议在 Cloudflare WAF 侧配置（Pages Functions 无状态，函数内自建计数器无效）。

### P1-5 一条「明文密钥写 localStorage」的死路径

`collectSyncApiConfig` 读 `import.meta.env.VITE_AGNES_API_KEY`，而 `.env` 中实际是 `AGNES_API_KEY`（无 `VITE_` 前缀），分支从未成立；一旦成立，`applySyncApiConfig` 会把密钥明文写入 `localStorage['medbox.agnesApi.v1']`，而该键全仓无人读取。

修复：整体移除 `agnes` 分支；旧对端发来的 `agnes` 字段现在会被 schema 拒绝；新增 `tests/lanSyncSecretContracts.test.ts` 守住「LAN 层写入 localStorage 的值不含密钥」。

### P1-6 更新元数据缺少完整性校验

客户端直接采用 `version.json` 的 `downloadUrl`（任意主机）并标记为可信 `cloud` 源，仅靠安装前验签兜底。

修复：下载主机白名单 + `fileSize` 字节数校验；`version.json` 增加 `sha256` 字段并在客户端解析透传（原生侧校验留作后续项）。

### P2-7 `public/version.json` 入库且随构建漂移

该文件由构建脚本重写却纳入版本控制，已提交值（32095374 / pages.dev）与线上值（16398223 / github）不一致，且每次 `build:web` 都会弄脏工作区。

修复：`.gitignore` 忽略并从索引移除（工作区文件保留）；新增 `tests/versionManifest.test.ts` 断言元数据与 `release/` 产物、`SHA256SUMS` 一致。

### P2-8 CI 缺密钥时用硬编码口令生成临时签名密钥

`release-apk.yml` 原逻辑在 secrets 缺失时用 `-storepass medbox123` 现造密钥，产出的 APK 与用户已安装应用签名不一致，既装不上也升不了级。

修复：改为缺任一 secret 直接 `exit 1` 并给出可执行提示。

### P2-9 `deploy-web.yml` 指向不存在的 GitHub Pages 站点

`https://misakii1k.github.io/xiaoyaohe/` 返回 404 `Site not found`。已删除该 workflow（需要时可在 Git 历史中恢复，或先启用 Pages 再重建）。

### P2-10 代理错误信息与响应头

原实现回显上游状态文本与 `err.message`；`download.ts` 兜底分支会把非 2xx 的上游 body 当 APK 流出；两条响应都缺少 `X-Content-Type-Options`。

修复：统一脱敏为 `UPSTREAM_ERROR`，兜底分支仅在 `res.ok` 时回传，补齐 `nosniff` 与 `Referrer-Policy`。

### P2-11 更新链路测试全程 mock，发现不了线上失效

原 `tests/apkUpdateVerification.test.ts` mock `fetch` 与原生插件，P0-1/P0-2 这类问题在 CI 里不可见。

修复：新增 `tests/functionsApi.test.ts`（17 项，直接驱动两个 Function handler）、`tests/versionManifest.test.ts`（3 项）、`scripts/check-release-endpoints.mjs`（线上冒烟，接入发布流水线）。

### P2-12 部署域名硬编码

`https://xiaoyaohe.pages.dev` 原先散落 3 处。修复：收敛为 `CLOUD_ORIGIN` 常量。

### P3-13 E2E 偶发失败（已定位并修复）

2 次运行中 1 次 exit 1，第 2 次 52/52 全绿。用 `npx playwright test --repeat-each=2` 复现后定位到唯一失败点：`e2e/assistant-cards.spec.ts:3` 在 `phone-320` 视口等待 `.ai-root.is-open .ai-panel` 超时（15s 预算）。

根因：该用例通过 `/?assistant-preview=1` 冷启动，需要 Vite dev server 现场转译 `assistantContent` 等懒加载分块，**单跑实测 13.0s**；并行门禁下必然打满 15s。失败瞬间的页面快照显示面板内容已渲染、卡片处于「内容加载中」状态，即纯粹的预算问题，不是面板缺陷。

修复：把该断言预算提高到 25s（仍小于 `playwright.config.ts` 的 30s 单测超时），并在 spec 内写明原因。复跑 `--repeat-each=2` → **104/104 全绿**。

### P3-14 未跟踪的令牌生成脚本

`scripts/check-gh.mjs` 与 `scripts/gen-token-exec.mjs` 内容基本重复，通过 CDP 驱动真实浏览器创建 GitHub PAT（申请全量 `repo` 权限）并写入 `scratch/gh_token.tmp`。本次未删除，处置待定。

### P3-15 局域网 APK 分发无配对鉴权

协议仅 8 字节 magic 头（`ApkDistributionPlugin.java:51`），服务随应用启动常驻，同网段任意设备可拉取安装包。安装前仍有签名校验，风险有限，记为已知接受项。

### P3-16 文档与版本漂移

- `docs/handoffs/CURRENT.md` 曾称「彻底解决 GitHub 私有仓库 404」，与实测 503 矛盾（本次已修正）。
- 根 `AGENTS.md` 曾写版本 0.9.7 / Node >= 22（本次已修正为 1.0.0 / Node 24）。

## 4. 未修复的已知接受项

| 项 | 说明 |
|---|---|
| CSP `connect-src 'self' https:` | 允许向任意 HTTPS 出站。用户可自配 LLM 端点，无法静态收窄；残余风险记录在案 |
| 局域网 APK 分发无鉴权 | 见 P3-15 |
| `sha256` 未在原生侧校验 | `version.json` 已带该字段，客户端仅透传；原生校验需要 Java 改动 + 插桩测试 |

## 5. 修复后的验证门

1. `npm run typecheck` 0 errors。
2. `npm run test` 全绿。
3. `npm run test:release` 全绿。
4. `npx playwright test` 全绿（建议 `--repeat-each=2`）。
5. `node scripts/check-release-endpoints.mjs`：配置 `GITHUB_TOKEN` 后 4 项全通。
6. 真机：0.9.x 安装包点「检查更新」能发现 1.0.0 并完成下载安装。
