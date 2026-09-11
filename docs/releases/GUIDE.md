# 小药盒线上更新分发与版本发布完整指南 (Release & Push SOP)

本文档系统性梳理了**小药盒（Xiaoyaohe）**应用的版本发布机制、应用内线上自动更新（热更新/冷更新）架构原理、从零搭建方案、标准发布 SOP 以及常见故障排查手册。

---

## 目录

1. [核心架构与在线更新原理](#一核心架构与在线更新原理)
2. [如何从零搭建线上推送更新链路](#二如何从零搭建线上推送更新链路)
3. [版本发布标准作业流程 (SOP Checklist)](#三版本发布标准作业流程-sop-checklist)
4. [关键脚本与工具速查](#四关键脚本与工具速查)
5. [高频故障排查与避坑手册 (FAQ)](#五高频故障排查与避坑手册-faq)

---

## 一、核心架构与在线更新原理

小药盒采用 **“GitHub Releases (产物持久化) + Cloudflare Pages Functions (海外边缘流式代理) + Android 原生安全下载器”** 的三层分发架构。

```
[ 用户 Android 客户端 ]
       │
       ├─ 1. 查询版本信息 ───> GET /version.json 或 /api/releases
       │                        │
       │                        ▼ (Cloudflare Pages 静态/Functions)
       │                        返回: 远端 versionCode, downloadUrl=/api/download?tag=vX.Y.Z
       │
       ├─ 2. 检查本地版本 ───> 本地 versionCode < 远端 versionCode 则弹出更新弹窗
       │
       └─ 3. 请求下载 APK ───> GET https://xiaoyaohe.pages.dev/api/download?tag=vX.Y.Z
                                │
                                ▼ [Cloudflare Edge Function: download.ts]
                                │ 携带 GITHUB_TOKEN 查询 GitHub Release API
                                │ 请求私有/公有 Release Asset 流
                                │ (内部 redirect: 'follow' 获取真实二进制)
                                │
                                ▼
                                边缘流式代理回传:
                                Content-Type: application/vnd.android.package-archive
                                (客户端全程不直连 GitHub / Azure Blob，避免国内 403 阻断)
                                │
                                ▼
[ Android ApkDistributionPlugin ]
  下载到应用私有 Cache ──> 校验 SHA256 ──> 唤起系统 FileProvider ──> 安装升级
```

### 为什么不能直接使用 GitHub Release 直链？

1. **私有仓库匿名 404**：小药盒代码仓库若设为私有，GitHub 生成的 `browser_download_url` 未登录用户访问直接返回 404。
2. **国内直连 403 Forbidden 与阻断**：
   - 过去曾尝试在 Cloudflare 函数中 302 重定向到 GitHub 真实下载地址（Azure Blob 节点 `release-assets.githubusercontent.com`）。
   - 实测在国内移动/电信网络环境下，直连该域名会触发 CDN 防盗链、签名超时或运营商拦截，客户端直接报错 `HTTP error 403: Forbidden`。
3. **解决方案**：
   - 由 Cloudflare 边缘节点（位于全球骨干网，访问 GitHub 极速无阻）跟随跳转，在服务端获取 APK 数据流；
   - 边缘节点以 `Response(assetRes.body)` 直接流式代理吐给国内客户端；
   - 客户端全程仅与同源域名 `https://xiaoyaohe.pages.dev` 通信，彻底杜绝 403 阻断。

---

## 二、如何从零搭建线上推送更新链路

若需要为新项目搭建同款线上更新能力，按以下四步进行：

### 1. GitHub 仓库与 Token 配置
- 生成一个只读权限的 GitHub Personal Access Token (PAT) 或 Fine-grained Token：
  - 权限要求：`Repository permissions` -> `Contents: Read`（允许读取 Releases 及 Release Assets）。
  - 复制 Token 备用。

### 2. Cloudflare Pages 配置
- 将项目连接到 Cloudflare Pages（或者使用 Wrangler 部署）。
- 构建设置：
  - 构建命令：`npm run build`
  - 构建输出目录：`dist`
- **关键环境变量**：
  - 在 Cloudflare Pages 后台 -> **Settings** -> **Environment variables** 中：
  - 添加变量名：`GITHUB_TOKEN`，值为步骤 1 申请的 Token，作用域勾选 `Production` 和 `Preview`。

### 3. Functions 代理路由部署
在项目根目录维护 `functions/api/` 目录（Cloudflare Pages 会自动编译为 Serverless 端点）：
- `functions/api/_shared.ts`：负责 GitHub API 地址组装、白名单 tag 正则校验（防止路径穿越攻击）、CORS 允许白名单设置。
- `functions/api/releases.ts`：返回指定或最新版本的 Release 元数据，将 APK 直链动态改写为同源 `/api/download?tag=...`。
- `functions/api/download.ts`：以流式代理方式回传 APK 文件。

### 4. Android 原生下载与安装配置
- 在 `AndroidManifest.xml` 中配置网络权限与安装未知应用权限：
  ```xml
  <uses-permission android:name="android.permission.INTERNET" />
  <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
  ```
- 配置 `FileProvider`（`res/xml/file_paths.xml` 映射私有 cache 目录）。
- 原生插件 `ApkDistributionPlugin.java` 负责原生断点/进度流式下载，并在请求头中带上标准化 User-Agent。

---

## 三、版本发布标准作业流程 (SOP Checklist)

> [!IMPORTANT]
> **切记**：应用更新强依赖 GitHub Releases 上的 APK 附件。**绝不能只打 Git Tag，必须完成全流程打包、推送并创建附带 APK 的 GitHub Release**，否则应用内检测到更新后点击下载会 404。

按以下 10 个步骤顺序执行：

### 步骤 1：确认分支与工作区状态
```powershell
# 必须在 medbox/ 目录下执行
git status
git branch --show-current
```
- 确认当前处于对应的开发分支（例如 `workspace/claude`）。

### 步骤 2：递增版本号与 versionCode
1. **修改 package.json**（不自动打 tag）：
   ```powershell
   npm version 1.0.x --no-git-tag-version
   ```
2. **修改 `android/app/build.gradle`**：
   ```groovy
   defaultConfig {
       versionCode 41    // 每次必须单调 +1
       versionName "1.0.x"
   }
   ```
3. **修改 `scripts/lib/release-utils.mjs`**：
   - 在 `VERSION_CODE_BY_VERSION` 映射表中补充：
   ```javascript
   '1.0.x': 41,
   '1.0.y': 42, // 预留下一版本
   ```

### 步骤 3：编写面向用户的发布说明
- 在 `docs/releases/` 目录下新增 `1.0.x.md`。
- **强制遵循 `oil-tone` 规范并减少专业术语**：面向普通用户平铺直叙，陈述客观改动和实际体验变化，严禁出现 DOM、CSS 类名、FAB、操作坞、微拟物、径向渐变、JNI、API 等晦涩技术黑话；成稿必须通过 `py C:\Users\87850\.gemini\config\skills\oil-tone\scripts\tone_lint.py docs/releases/1.0.x.md` 校验。
- 示例参考：`docs/releases/1.0.7.md`。

### 步骤 4：更新多工具交接文档 (Handoff)
- 更新 `docs/handoffs/CURRENT.md`：更新顶部 `Product version: 1.0.x`，增加本次改动的完成条目。
- 更新当前工具的 handoff（例如 `docs/handoffs/claude.md`）：更新最新版本与本次开发详情。

### 步骤 5：同步与版本相关的测试用例
- 若本地版本号提升，运行依赖当前版本的测试用例可能会比对本地版本号（例如 `tests/release-utils.test.ts`、`tests/apkUpdateVerification.test.ts`）：
  - 将 `tests/release-utils.test.ts` 中的预期版本调整为 `'1.0.x'`；
  - 将 `tests/apkUpdateVerification.test.ts` 中的更新候选 mock 版本调整为大于当前 `versionCode` 的版本（如 `1.0.y` / `42`）。

### 步骤 6：全量质量门禁验证
```powershell
npm test             # 必须 100% 测试通过
npm run typecheck    # 必须 0 错误
npm run build:web    # 生产构建与静态资源校验
npm run cap:sync     # 同步 web 构建产物到 Android assets
```

### 步骤 7：Git 提交与打 Tag
```powershell
git add .
git commit -m "release: v1.0.x - <核心功能简述>"
git tag v1.0.x
```

### 步骤 8：编译 Android 正式版 APK
```powershell
cd android
.\gradlew.bat assembleRelease
cd ..
```
*编译成功后产物位于：`android/app/build/outputs/apk/release/app-release.apk`*

### 步骤 9：归档 APK、计算 SHA256 与体积比对
```powershell
# 复制到 release 目录并命名为规范文件名
Copy-Item android\app\build\outputs\apk\release\app-release.apk release\xiaoyaohe-1.0.x-android-release.apk

# 计算 SHA256 哈希
Get-FileHash -Algorithm SHA256 release\xiaoyaohe-1.0.x-android-release.apk

# 写入校验和文件
"<sha256_hash_lowercase> *xiaoyaohe-1.0.x-android-release.apk" | Set-Content -Encoding utf8 release\xiaoyaohe-1.0.x-SHA256SUMS.txt

# 同步更新 public/version.json（提取真实体积与哈希）
node scripts/gen-version.mjs
```
> [!TIP]
> **产物体积比对**：将新生成的 APK 字节数与上一版本对比（通常在 50MB 左右）。若体积突降几十 MB 说明静态资源未同步；若突增几十 MB 说明打包了冗余大文件，需确认无误后才可发布。

### 步骤 10：推送代码并创建 GitHub Release
```powershell
# 推送分支与 tag
git push origin <当前分支名>
git push origin v1.0.x

# 使用 GitHub CLI 创建带有 APK 附件的正式 Release
gh release create v1.0.x release\xiaoyaohe-1.0.x-android-release.apk release\xiaoyaohe-1.0.x-SHA256SUMS.txt --title "v1.0.x" --notes-file docs\releases\1.0.x.md
```

### 步骤 11：自动化线上链路冒烟检查
推送完成后，运行项目内置的线上全链路冒烟脚本：
```powershell
node scripts/check-release-endpoints.mjs
```
该脚本会自动请求线上 `https://xiaoyaohe.pages.dev`：
- [x] 验证 `version.json` 格式与字段；
- [x] 验证 `/api/releases` 接口是否连通并识别 APK；
- [x] 验证非法 tag 防御（HTTP 400）；
- [x] 验证 `/api/download` 能否成功获取 APK 二进制流。
显示 **`4/4 通过`** 即代表全线上发布圆满成功！

---

## 四、关键脚本与工具速查

| 脚本 / 文件 | 说明 |
|---|---|
| `scripts/gen-version.mjs` | 生成 `public/version.json`，自动提取 APK 大小与 SHA256 |
| `scripts/release.mjs` | 本地发布助手与端到端质检构建工具 |
| `scripts/check-release-endpoints.mjs` | **线上分发全链路冒烟测试**（直接打线上接口验证 4 项指标） |
| `scripts/lib/release-utils.mjs` | 版本号解析、versionCode 映射及签名与产物校验核心库 |
| `functions/api/download.ts` | 边缘流式代理下载端点 |
| `functions/api/releases.ts` | Release 动态元数据端点 |

---

## 五、高频故障排查与避坑手册 (FAQ)

### Q1: 客户端检测到新版本，但点击更新提示 404？
- **原因**：只推送了 git tag，没有在 GitHub 上通过 `gh release create` 或网页端发布 Release 并上传 `.apk`。
- **解法**：检查 `https://github.com/Misakii1k/xiaoyaohe/releases/tag/vX.Y.Z`，确保 Release 存在且资产中包含 `xiaoyaohe-X.Y.Z-android-release.apk`。

### Q2: 检查更新返回 503 Service Unavailable？
- **原因**：Cloudflare Pages 没有读取 GitHub 仓库的权限（未配置 `GITHUB_TOKEN` 或 Token 已失效）。
- **解法**：在 Cloudflare Pages 后台设置中更新有效的 `GITHUB_TOKEN` 环境变量。

### Q3: 客户端下载更新报错 HTTP error 403: Forbidden？
- **原因**：历史版本中 `download.ts` 返回了 302 临时重定向，导致国内移动客户端直连 GitHub 底层 Azure Blob CDN 被拒。
- **解法**：确保 `download.ts` 使用 `redirect: 'follow'`，由 Cloudflare 边缘直接流式回传二进制，绝不向客户端下发 302。

### Q4: Gradle 构建报 `Premature end of Content-Length`？
- **原因**：aliyun 等国内 Maven 镜像在下载大体积依赖（如 Android SDK 核心包）时偶发网络中断。
- **解法**：使用 `curl -C -` 循环断点续传从 `repo1.maven.org` 拉取，并按 sha1 目录格式预置到 Gradle 缓存中。

### Q5: 为什么修改版本后运行 `npm test` 会有测试失败？
- **原因**：`src/features/apkTransport.ts` 中内嵌了当前版本的 `LOCAL_APP_VERSION_CODE`。如果测试用例 mock 候选版本的 versionCode 小于等于当前本地版本，测试逻辑会判定为“已是最新版本”而忽略更新。
- **解法**：同步修改 `tests/apkUpdateVerification.test.ts`，将测试 mock 的更新候选版本设置为大于当前版本（例如当前是 1.0.5 / code 40，测试需 mock 1.0.6 / code 41）。
