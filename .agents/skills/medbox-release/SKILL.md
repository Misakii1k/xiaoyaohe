---
name: medbox-release
description: >-
  小药盒 (xiaoyaohe) 线上更新分发与版本发布标准作业程序 (SOP)。
  在用户要求发布版本、推送新版本、发版、打包发布 APK 或推送更新（例如“发布版本”、“推送1.0.x版本”、“推送新版本”、“发版”、“上线版本”）时触发。
---

# 小药盒版本发布标准作业程序 (Release SOP)

当需要为小药盒发布新版本时，必须严格按照以下 10 步流程执行。

> [!IMPORTANT]
> **核心铁律**：
> 1. 应用内在线更新依赖 GitHub Releases 上的 APK 附件，**绝不能只打 Git Tag**，必须完整构建 Release APK 并通过 `gh release create` 上传附件。
> 2. 生成 APK 并放入 `release/` 后，**必须执行 `node scripts/gen-version.mjs`**，否则 `public/version.json` 缺少体积与 SHA256，会导致 `tests/versionManifest.test.ts` 失败。
> 3. 发布完成后，**必须执行 `node scripts/check-release-endpoints.mjs`** 验证 4 项线上指标全部通过。

---

## 发布步骤检查单

### 1. 确认工作区与分支状态
必须在 `medbox/` 目录下操作：
```powershell
git status
git branch --show-current
```
确认当前处于对应开发分支（如 `workspace/claude`）。

### 2. 递增版本号与 versionCode
- `package.json`：
  ```powershell
  npm version <X.Y.Z> --no-git-tag-version
  ```
- `android/app/build.gradle`：
  ```groovy
  defaultConfig {
      versionCode <N>    // 必须单调 +1
      versionName "<X.Y.Z>"
  }
  ```
- `scripts/lib/release-utils.mjs`：
  在 `VERSION_CODE_BY_VERSION` 中补充版本与 code 映射。

### 3. 维护依赖当前版本号的测试用例
- `tests/release-utils.test.ts`：将预期版本调整为 `'<X.Y.Z>'`。
- `tests/apkUpdateVerification.test.ts`：将 candidate mock 版本的 `versionCode` 与版本号调整为**大于**当前本地版本（例如当前 40，测试 mock 41），否则会触发“本地已是最新版本无需更新”逻辑而导致测试报错。

### 4. 编写发布说明与交接文档
- 在 `docs/releases/<X.Y.Z>.md` 创建版本发布说明。
- 更新 `docs/handoffs/CURRENT.md`（顶部 Product version 及更新条目）。
- 更新当前工具 handoff（如 `docs/handoffs/claude.md`）。

### 5. 执行门禁质检
```powershell
npm test             # 必须 84 个测试套件 100% 通过
npm run typecheck    # 必须 0 错误
npm run build:web    # 生产资源构建
npm run cap:sync     # 同步 Web 产物至 Android 原生 assets
```

### 6. Git 提交与打 Tag
```powershell
git add .
git commit -m "release: v<X.Y.Z> - <说明>"
git tag v<X.Y.Z>
```

### 7. 编译 Android 正式版 APK
```powershell
cd android
.\gradlew.bat assembleRelease
cd ..
```
产物位于：`android/app/build/outputs/apk/release/app-release.apk`。

### 8. 产物归档、校验和与 version.json 同步
```powershell
# 归档至 release 目录
Copy-Item android\app\build\outputs\apk\release\app-release.apk release\xiaoyaohe-<X.Y.Z>-android-release.apk

# 计算 SHA256 哈希并写入校验和文件
$hash = (Get-FileHash -Algorithm SHA256 release\xiaoyaohe-<X.Y.Z>-android-release.apk).Hash.ToLower()
"$hash *xiaoyaohe-<X.Y.Z>-android-release.apk" | Set-Content -Encoding utf8 release\xiaoyaohe-<X.Y.Z>-SHA256SUMS.txt

# 同步更新 public/version.json（提取真实体积与哈希）
node scripts/gen-version.mjs
```
*提示：对比 APK 体积与上一版本（通常约 50MB），偏差过大时排查原因。*

### 9. 推送代码与创建 GitHub Release
```powershell
# 推送分支与 tag
git push origin <当前分支>
git push origin v<X.Y.Z>

# 通过 gh CLI 创建 Release 并上传 APK 与校验和
gh release create v<X.Y.Z> release\xiaoyaohe-<X.Y.Z>-android-release.apk release\xiaoyaohe-<X.Y.Z>-SHA256SUMS.txt --title "v<X.Y.Z>" --notes-file docs\releases\<X.Y.Z>.md
```

### 10. 线上链路冒烟自动化测试
```powershell
node scripts/check-release-endpoints.mjs
```
必须输出 `4/4 通过`：
1. `version.json` 字段正确且 `downloadUrl` 走同源代理；
2. `/api/releases` 识别有效 APK 资产；
3. 非法 tag 路径穿越被拒 (HTTP 400)；
4. `/api/download` 成功获取 APK 流且无 403。
