# 数药片功能 4.0（一期：云端视觉定位 + 本地样本/网格校准 + 业务闭环）实施计划

> **执行指引：** 在 `medbox/` 仓库当前工作分支 `workspace/claude` 上按任务顺序以 TDD 方式逐步实施；全程遵守 `medbox/AGENTS.md`（优先使用 `src/ui/primitives/` 自绘控件、禁用液态玻璃 `backdrop-filter: blur`、状态胶囊强制防折行、不改动他人未提交删除的 `design/brand/raw/` 资源）。

**目标：** 彻底解决散落药片、多药混装与未拆封铝塑泡罩板在真实手机拍照场景下的漏数/误数问题，以手机端零包体增重方式上线“云端定位 + 离线双模交互校准 + 库存/分药/AI 助手闭环”，并为二期按需下载离线 YOLO 保留统一引擎接口。

**核心架构：**
1. **双阶段引擎接口（`PillDetectionEngine`）**：一期接入 `cloud`（Cloudflare Pages Function `/api/count-pills` 调用 Workers AI `@cf/moondream/moondream3.1-9B-A2B` 的 `point`/`detect` 接口）与 `sample_local` / `heuristic_local`（升级 Lab 色差、点选样本区域生长、铝塑板透视网格对齐与外观色彩簇分组）；二期可直接挂载可选下载的 `yolo_local` 适配器。
2. **隐私授权与降级策略**：未授权外发前先秒出本地兜底结果并在弹层顶展示一键授权横幅（不阻塞界面，且严守 `src/ai/consent.ts` 绝不静默上传）；授权后每次优先压缩至长边 `1024px` 发往云端，遇到断网、429 限流、503 未绑定或 8 秒超时自动平滑降级本地。
3. **拍照、微调与业务闭环**：相机页新增「散落药片 / 整板药片」分段切换与手电筒补光（保持 `.camera-actions` 原有三键契约不变）；清点弹层支持双指缩放/单指平移、撤销、暂隐标点、局部框选重数、样本校准、药板网格切空/满；确认后可一键设为剩余库存、入库累加或核对分药用量，并在库存页与 AI 小助手内全程打通。

**技术栈：** TypeScript · Vite · Cloudflare Pages Functions & Workers AI (`@cf/moondream/moondream3.1-9B-A2B`) · HTML5 Canvas 2D / Pointer Events · `src/ui/primitives/` · Vitest · Playwright

---

### Task 1: 统一引擎类型契约与隐私授权扩展

**Files:**
- Create: `src/features/pillEngine.ts`
- Modify: `src/ai/consent.ts:1-40`
- Test: `tests/pillEngine.test.ts`

**Step 1: 编写失败测试**

创建 `tests/pillEngine.test.ts`，验证 `consentCategoryFor('pill-photo')` 归类为 `'health'`，且 `pillEngine.ts` 导出的模式、引擎类型与二期 YOLO 提供者注册表初始为空：

```ts
import { describe, expect, it } from 'vitest';
import { consentCategoryFor } from '../src/ai/consent';
import {
  getRegisteredLocalYoloProvider,
  normalizePillPoints,
  type PillDetectionMode,
} from '../src/features/pillEngine';

describe('pillEngine contracts & consent', () => {
  it('maps pill-photo to health consent category', () => {
    expect(consentCategoryFor('pill-photo')).toBe('health');
  });

  it('normalizes normalized [0..1] cloud points to pixel coords and deduplicates near-identical points', () => {
    const mode: PillDetectionMode = 'loose';
    const pts = normalizePillPoints(
      [
        { x: 0.5, y: 0.5 },
        { x: 0.503, y: 0.502 },
        { x: 0.2, y: 0.25 },
      ],
      1000,
      800,
      { mode },
    );
    expect(pts).toHaveLength(2);
    expect(pts[0]).toMatchObject({ x: 500, y: 400, isManual: false });
    expect(pts[1]).toMatchObject({ x: 200, y: 200, isManual: false });
  });

  it('exposes optional phase-2 YOLO hook defaulting to null', () => {
    expect(getRegisteredLocalYoloProvider()).toBeNull();
  });
});
```

**Step 2: 运行测试确认失败**

Run: `npx vitest run tests/pillEngine.test.ts`
Expected: FAIL（`src/features/pillEngine` 不存在且 `'pill-photo'` 不在 `AiDataKind` 中）

**Step 3: 实现最小代码**

1. 在 `src/ai/consent.ts` 将 `AiDataKind` 扩展为 `'medicine-photo' | 'prescription' | 'pill-photo' | 'assistant-chat' | 'web-search'`（`consentCategoryFor` 自动将其归入 `'health'`）。
2. 新建 `src/features/pillEngine.ts`，定义：
   - `PillDetectionMode = 'loose' | 'blister'`
   - `PillDetectionEngineKind = 'cloud' | 'yolo_local' | 'sample_local' | 'blister_grid' | 'heuristic_local'`
   - `PillPoint`（含 `x, y, id, isManual?, group?, confidence?, box?`）
   - `PillAppearanceCluster`（`{ label: string; count: number; swatch: string; pointIds: number[] }`）
   - `PillGridConfig`（`{ rows: number; cols: number; corners: [{x,y},{x,y},{x,y},{x,y}]; cells: boolean[] }`）
   - `LocalYoloProvider` 接口及 `registerLocalYoloProvider` / `getRegisteredLocalYoloProvider`
   - `normalizePillPoints`（归一化 `[0..1]` 转像素坐标 + `minDistRatio` 去重）

**Step 4: 运行测试确认通过**

Run: `npx vitest run tests/pillEngine.test.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add src/ai/consent.ts src/features/pillEngine.ts tests/pillEngine.test.ts
git commit -m "feat(pill): define pill detection engine contracts and consent kind"
```

---

### Task 2: Cloudflare Pages Function 云端定位端点（`/api/count-pills`）

**Files:**
- Modify: `functions/api/_shared.ts:13-25,130-140`
- Create: `functions/api/count-pills.ts`
- Test: `tests/functionsApi.test.ts`

**Step 1: 编写失败测试**

在 `tests/functionsApi.test.ts` 追加测试套 `Cloudflare Functions: count-pills`：
1. 非 `POST` / 非法 `Origin` 校验与 `OPTIONS` 预检支持 `POST`；
2. 缺 `env.AI` 绑定返回 `503 AI_NOT_BOUND`；
3. 图片体积超限（> `1.5 MB` base64）返回 `413 PAYLOAD_TOO_LARGE`；
4. `mode: 'loose'` 调用 `env.AI.run('@cf/moondream/moondream3.1-9B-A2B', { task: 'point', ... })` 使用散落药片 target，`mode: 'blister'` 使用未拆封有药泡罩 target；
5. 同一 IP 短时间高频请求触发限流返回 `429 RATE_LIMITED`。

**Step 2: 运行测试确认失败**

Run: `npx vitest run tests/functionsApi.test.ts`
Expected: FAIL（`functions/api/count-pills` 模块不存在）

**Step 3: 实现最小代码**

1. 在 `functions/api/_shared.ts` 中：
   - `Env` 接口补充 `AI?: { run: (model: string, input: Record<string, unknown>) => Promise<unknown> }`；
   - 新增 `postCorsHeaders(request)`（或给 `corsHeaders` 传允许方法参数，保持既有 `GET, OPTIONS` 端点行为不变，`/api/count-pills` 回 `POST, OPTIONS`）。
2. 新建 `functions/api/count-pills.ts`：
   - 导出 `onRequestOptions` 与 `onRequestPost`（`onRequestGet` 返回 `405`）；
   - 校验 JSON 请求体：`image`（`data:image/jpeg;base64,...` 且解码长度 `<= 1_200_000` 字节）、`mode`（`'loose' | 'blister'`，默认 `'loose'`）；
   - 按 `CF-Connecting-IP` 做轻量滑窗限流（例如单 IP 每分钟 15 次，保护每天 10,000 Neurons 免费额度；导出 `resetCountPillsRateLimiterForTest()` 供单测重置）；
   - 调用 `env.AI.run('@cf/moondream/moondream3.1-9B-A2B', { task: 'point', image, target, max_objects: 250 })`：
     - `loose`：`target = 'pill, tablet, or capsule'`
     - `blister`：`target = 'unopened blister pocket containing a pill or capsule'`
   - 兼容解析返回结果（`points` 数组或 `{ x, y }` 归一化坐标），返回 `{ ok: true, mode, engine: 'cloud', points }`。

**Step 4: 运行测试确认通过**

Run: `npx vitest run tests/functionsApi.test.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add functions/api/_shared.ts functions/api/count-pills.ts tests/functionsApi.test.ts
git commit -m "feat(api): add Cloudflare Workers AI /api/count-pills endpoint"
```

---

### Task 3: 升级本地兜底引擎（Lab 色距 + 点样本校准 + 药板网格 + 混装分组）

**Files:**
- Modify: `src/features/pillDetection.ts`
- Test: `tests/pillDetection.test.ts`

**Step 1: 编写失败测试**

在 `tests/pillDetection.test.ts` 保留全部现有 19 项契约测试不退化，并新增 4 组测试：
1. **点一颗当样本（单色低对比/杂乱背景下）**：画面含强干扰大色块 + 低对比白药片，只传入 1 个样本点击坐标调用 `detectPillsFromSample(imgData, [{ x, y }])`，仅检出同类药片而不误检桌面杂物；
2. **多样本混装校准**：画面中有白色圆片 3 颗 + 红色胶囊 2 颗 + 杂物，传入 2 个样本点击坐标调用 `detectPillsFromSample`，准确检出 5 颗；
3. **铝塑板行列网格评估**：构造 `2×3` 泡罩矩阵（4 格有白药片、2 格为空泡阴影），调用 `evaluateBlisterGrid(imgData, { rows: 2, cols: 3, corners })`，准确标出 4 个 `filled` 格并返回 4 个中心点；
4. **混装外观自动聚类**：对白片 + 红胶囊混合点位运行 `clusterPillAppearances(imgData, points)` 返回 2 个外观组（总和等于总粒数），而纯单种药只返回空/单组提示不打扰。

**Step 2: 运行测试确认失败**

Run: `npx vitest run tests/pillDetection.test.ts`
Expected: FAIL（`detectPillsFromSample`、`evaluateBlisterGrid`、`clusterPillAppearances` 未定义）

**Step 3: 实现最小代码**

在 `src/features/pillDetection.ts` 中：
1. 将背景前景感知色距升级为近似 **CIE Lab**（`rgbToLab`）以改善相近亮度但不同色相/浅色桌面场景，并增强纯纹理空桌面的方差抑制。
2. 新增 `detectPillsFromSample(imgData, samplePoints, options)`：
   - 对每个用户点选样本坐标做局部区域生长（以局部背景均值和样本核心像素做双边界收敛），提取该类药片的 `[L, a, b]` 均值与估计半径 `rSample`；
   - 按所有样本色域建联合前景掩膜，并保留既有 Chamfer 距离变换 + 鞍点校验 + 半径自适应合并（过滤桌面边缘大块杂物与纹理噪点）；
   - 支持裁剪区域 `roi?: { x, y, width, height }` 限定范围。
3. 新增 `evaluateBlisterGrid(imgData, config: { rows, cols, corners })`：
   - 通过双线性透视映射将 `rows × cols` 格子映射到图像采样区域，统计每个格子中心区与边缘环的亮度均值、饱和度与高光比例，做自适应二分类得出每个格子的 `filled: boolean` 与中心坐标。
4. 新增 `clusterPillAppearances(imgData, points)`：
   - 采样每个点周围 `5×5` Lab 中值，仅当颜色欧氏距离超过明显阈值（$\Delta E > 22$）且至少有 2 个以上独立组时返回简短外观分组标签（如 `浅色药片 4 · 彩色胶囊 2`）。

**Step 4: 运行测试确认通过**

Run: `npx vitest run tests/pillDetection.test.ts`
Expected: PASS（既有 19 项 + 新增 4 项全绿）

**Step 5: 提交**

```bash
git add src/features/pillDetection.ts tests/pillDetection.test.ts
git commit -m "feat(pill): add Lab sample calibration, blister grid evaluator, and appearance clustering"
```

---

### Task 4: 云端与本地统一编排客户端 + 1024px 预处理

**Files:**
- Create: `src/features/pillCounterClient.ts`
- Test: `tests/pillCounterClient.test.ts`

**Step 1: 编写失败测试**

创建 `tests/pillCounterClient.test.ts`（mock `fetch`、Canvas 与 `consent`）：
1. 已授权且联网时优先走 `${CLOUD_ORIGIN}/api/count-pills`，携带压缩图与 `mode`，成功时返回 `engine: 'cloud'`；
2. 未授予 `'pill-photo'` 外发同意时**绝不发出网络请求**，直接返回 `engine: 'heuristic_local'` 且标记 `consentNeeded: true`；
3. 云端返回 `429` / `503` / 网络异常 / 超时时，自动无感降级到本地检测并附带 `degradedReason`；
4. 若注册了 Phase 2 `LocalYoloProvider`，断网/跳过云端时优先调用 `yolo_local`。

**Step 2: 运行测试确认失败**

Run: `npx vitest run tests/pillCounterClient.test.ts`
Expected: FAIL（`src/features/pillCounterClient` 不存在）

**Step 3: 实现最小代码**

在 `src/features/pillCounterClient.ts` 中：
1. 实现 `preparePillImage(source, { maxDim: 1024, roi? })`：输出展示用 `canvas` / `rawImgData` 与压缩后 `jpegDataUrl`（`quality: 0.82`，确保尺寸控制在云端上限内）。
2. 实现 `runPillDetectionPipeline(options)`：
   - 支持传 `roi` 局部裁剪区域重算并把返回点坐标自动平移回整图坐标系；
   - 检查 `hasAiConsent('pill-photo', CLOUD_ORIGIN)`（仅在 `allowCloud !== false` 且 `forceConsent` 或已授权时请求云端；非阻塞首屏打开走 `consentNeeded: true` 标记）；
   - 8 秒 `AbortController` 超时保护，失败时按 `yolo_local`（若已注册）→ `heuristic_local` 顺序兜底，并调用 `clusterPillAppearances` 生成混装统计。

**Step 4: 运行测试确认通过**

Run: `npx vitest run tests/pillCounterClient.test.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add src/features/pillCounterClient.ts tests/pillCounterClient.test.ts
git commit -m "feat(pill): add cloud-first detection orchestrator with graceful local fallback"
```

---

### Task 5: 相机取景模式切换与手电筒补光升级

**Files:**
- Modify: `src/pages/ScanSort.ts:649-702,1532-1677`
- Modify: `src/ui/styles/pages/scanner.css:470-505`
- Test: `tests/scannerUiContracts.test.ts`
- Test: `e2e/camera-actions.spec.ts`

**Step 1: 编写失败测试**

1. 在 `tests/scannerUiContracts.test.ts` 新增断言：`openPillCamera` 接入 `createSegmentedControl`（含 `散落药片` / `整板药片`）及补光按钮 `.pill-camera-toolbar`，且 `.camera-actions` 内严格保持原有 3 个按钮不破坏契约；
2. 在 `e2e/camera-actions.spec.ts` 验证点击「快速数药片」后模式切换控件可见，切换到「整板药片」状态更新正确。

**Step 2: 运行测试确认失败**

Run: `npx vitest run tests/scannerUiContracts.test.ts && npx playwright test e2e/camera-actions.spec.ts`
Expected: FAIL

**Step 3: 实现最小代码**

1. 在 `src/pages/ScanSort.ts` 的 `openCameraCapture` 中新增可选 `toolbarEl?: HTMLElement` 参数插在 `.camera-preview` 上方（绝不放进 `.camera-actions`），并在拿到 `MediaStream` 后检测 `videoTrack.getCapabilities?.()?.torch`：若硬件支持则在工具条展示补光灯切换键（`applyConstraints({ advanced: [{ torch: next }] })`），关闭相机时自动复位停止轨道。
2. 在 `openPillCamera` 中使用 `createSegmentedControl` 提供 `'loose' | 'blister'` 模式切换，同步更新引导副标题并传给 `startPillCounting(file, currentMode)`。
3. 在 `src/ui/styles/pages/scanner.css` 为 `.pill-camera-toolbar` 与补光按钮补充纯实色微质感样式（禁用 `backdrop-filter`，遵守单行防折行规则）。

**Step 4: 运行测试确认通过**

Run: `npx vitest run tests/scannerUiContracts.test.ts && npx playwright test e2e/camera-actions.spec.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add src/pages/ScanSort.ts src/ui/styles/pages/scanner.css tests/scannerUiContracts.test.ts e2e/camera-actions.spec.ts
git commit -m "feat(camera): add loose/blister mode toggle and torch control for pill camera"
```

---

### Task 6: 交互式清点弹层重做（双指缩放 / 撤销 / 框选 / 点样本 / 网格对齐）

**Files:**
- Modify: `src/features/pillCounter.ts`
- Modify: `src/ui/styles/pages/pill-counter.css`
- Test: `tests/pillCounterUi.test.ts`
- Test: `e2e/pill-counter.spec.ts`

**Step 1: 编写失败测试**

1. 创建 `tests/pillCounterUi.test.ts`（happy-dom）：
   - 渲染 `openPillCounterSheet` 后：存在 `SegmentedControl`（散落药片/整板药片）、`撤销` 按钮、`点样本校准` 模式按钮、`框选范围` 按钮、`长按看原图` 开关；
   - 点击「点样本校准」后点击画布会调用样本检测并推入撤销栈，点击「撤销」恢复前一次点集合；
   - 未授予云端同意时显示非阻塞的「开启云端高精度识别」横幅（点击后触发 `grantAiConsentForOrigins` 并重算），且不阻塞已有本地标点渲染。
2. 扩展 `e2e/pill-counter.spec.ts`：
   - 验证既有 5 粒手动补点/删点/确认流程 100% 通过；
   - 验证切换至「整板药片」并启用「行列网格」调整行列步进器与切换格子空/满状态后计数联动更新。

**Step 2: 运行测试确认失败**

Run: `npx vitest run tests/pillCounterUi.test.ts && npx playwright test e2e/pill-counter.spec.ts`
Expected: FAIL

**Step 3: 实现最小代码**

1. 重写 `src/features/pillCounter.ts`：
   - **顶部控制区**：标题 + 降级/来源提示（大白话，去掉“算法用时 ms”技术腔）+ `nowrap` 计数徽标 `共 N 粒` + 混装外观分组摘要胶囊条（仅多类时显示）+ `SegmentedControl`（散落/整板，切换自动重算）；
   - **首次云端授权非阻塞引导条**：当 `consentNeeded === true` 时展示轻量提示卡与「开启云端识别」按钮（使用 `grantAiConsentForOrigins([CLOUD_ORIGIN], ...)`），授权后立刻调云端刷新标点；
   - **缩放与手势画布**：基于 Pointer Events (`pointerdown` / `pointermove` / `pointerup`) 支持双指捏合缩放（`1x ~ 4x`）、单指拖动画布（区分短按点选与拖拽位移阈值 `6px`）以及一键「还原」视图按钮；自适应标点半径（点数 > 25 时自动缩细圆圈，避免遮挡相邻药片）；
   - **工具模式栏**：
     - `点选`（默认补点/删点，每次变更压入 `undoStack`）；
     - `点样本`（点中画面某颗药片，调 `detectPillsFromSample` 支持多类连续追加或覆盖）；
     - `框选`（拖拽画矩形 ROI，点击「仅数框内」传 `roi` 重算，支持清除框选）；
     - `药板网格`（仅整板模式显示，提供行/列 `createStepper` + 画布四角可拖拽控制点 + 点击单元格切空/满）；
     - `原图对比`（按下暂隐标点与网格，松手恢复）+ `撤销`。
2. 更新 `src/ui/styles/pages/pill-counter.css`：严格采用实色表面 `--color-surface-solid`、`1px` 微边框，无任何 `backdrop-filter`；状态徽章与工具按钮全部声明 `white-space: nowrap; flex-shrink: 0; min-width: max-content;`；列向/网格操作按钮遵循 `flex: 0 0 auto; min-block-size: var(--tap);`。

**Step 4: 运行测试确认通过**

Run: `npx vitest run tests/pillCounterUi.test.ts && npx playwright test e2e/pill-counter.spec.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add src/features/pillCounter.ts src/ui/styles/pages/pill-counter.css tests/pillCounterUi.test.ts e2e/pill-counter.spec.ts
git commit -m "feat(pill): rebuild counter sheet with pinch-zoom, undo, ROI crop, sample calibration, and blister grid"
```

---

### Task 7: 业务闭环（回填库存 / 分药核对 / 库存页入口）

**Files:**
- Create: `src/features/pillCounterFollowup.ts`
- Modify: `src/pages/ScanSort.ts:682-702`
- Modify: `src/pages/MedInventory.ts:94-120`
- Test: `tests/pillCounterFollowup.test.ts`
- Test: `e2e/pill-counter.spec.ts`

**Step 1: 编写失败测试**

1. 创建 `tests/pillCounterFollowup.test.ts`（配合 `fake-indexeddb`）：
   - 选择某药品执行「设为当前剩余」→ 调用 `updateMedicationInventory(..., { action: 'set', ... })` 成功落库并写入 `inventoryLogs`；
   - 选择某药品执行「入库累加」→ 库存正确累加；
   - 单位不兼容（如药品单位是 `盒` 而试图以 `片` 强设）→ 明确给出友好错误提示，不静默篡改单位；
   - 选择「核对分药用量」→ 结合药品 `getConfirmedDose` 与启用规则计算当日应取总片数并输出差额文案（`刚好` / `多了 N` / `还差 N`）。
2. 在 `e2e/pill-counter.spec.ts` 新增库存页入口与盘点回填流程测试。

**Step 2: 运行测试确认失败**

Run: `npx vitest run tests/pillCounterFollowup.test.ts`
Expected: FAIL

**Step 3: 实现最小代码**

1. 新建 `src/features/pillCounterFollowup.ts`：
   - 导出 `openPillCountFollowupSheet({ count, defaultMedId?, mode, onDone })`，使用 `openBottomSheet` + `createSelectControl`（选药）+ `createSegmentedControl`（`设为剩余` / `入库累加` / `核对分药`）+ `createButton`（`确认执行` / `仅复制数量关闭`）；
   - 通过 `listMeds()` / `listRules()` / `updateMedicationInventory()` / `rescheduleMedicationReminders()` 完成闭环，并触发清晰 Toast。
2. 修改 `src/pages/ScanSort.ts` 的 `startPillCounting`：`onConfirm` 确认后唤起 `openPillCountFollowupSheet`（保留 `已完成清点` 提示体验的同时提供可选回填/核对与快速关闭）。
3. 修改 `src/pages/MedInventory.ts` 的 `openOperationsSheet`：新增「拍照数药片」入口卡，拉起拍照/选图 → `openPillCounterSheet` → `openPillCountFollowupSheet` 并自动刷新库存列表。

**Step 4: 运行测试确认通过**

Run: `npx vitest run tests/pillCounterFollowup.test.ts && npx playwright test e2e/pill-counter.spec.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add src/features/pillCounterFollowup.ts src/pages/ScanSort.ts src/pages/MedInventory.ts tests/pillCounterFollowup.test.ts e2e/pill-counter.spec.ts
git commit -m "feat(pill): connect pill counting to inventory updates, sort check, and inventory page entry"
```

---

### Task 8: AI 小助手 `count_pills` 深度联动与标点预览卡

**Files:**
- Modify: `src/ai/tools/pillTools.ts`
- Modify: `src/ai/assistant.ts:72-95,175,396-413`
- Modify: `src/ui/assistantContent.ts:138-188`
- Modify: `src/ui/AiAssistant.ts:1056-1080`
- Test: `tests/pillCounter.test.ts`

**Step 1: 编写失败测试**

在 `tests/pillCounter.test.ts` 更新并补充测试：
1. `countPillsTool.run({ mode: 'blister' }, { attachment })` 走 `runPillDetectionPipeline`（不再只调旧单算法），返回包含 `ui` 卡片块（携带紧凑标点预览图或点阵元数据 `pillCountPreview`）；
2. `contentBlockOf` 能安全识别带 `pillCountPreview` 的 `AssistantCardBlock`；
3. `renderAssistantBlock` 渲染该卡片时展示缩略标点图及「微调并回填库存」可点击按钮，且在无 `dataUrl` 历史回放时安全降级不报错。

**Step 2: 运行测试确认失败**

Run: `npx vitest run tests/pillCounter.test.ts`
Expected: FAIL

**Step 3: 实现最小代码**

1. 改造 `src/ai/tools/pillTools.ts`：
   - 工具入参增加可选 `mode: 'loose' | 'blister'`；
   - 调用 `runPillDetectionPipeline`（复用当前对话附带图片），生成压缩版干净原图（用于再次打开 `openPillCounterSheet`）与带点预览缩略图；
   - 在工具返回值挂载结构化 `ui` 卡片（`AssistantCardBlock` 扩展可选 `pillPreview?: { imageDataUrl: string; annotatedDataUrl: string; points: PillPoint[]; mode: PillDetectionMode; medName?: string }`，注意持久化前做尺寸控制避免撑爆 IndexedDB）。
2. 在 `src/ui/assistantContent.ts` 渲染卡片内联标点预览图，并附带「微调并回填库存」按钮，点击后唤起 `openPillCounterSheet`（注入 `initialPoints` 与 `imageDataUrl`）→ `openPillCountFollowupSheet`。
3. 同步更新 `src/ai/assistant.ts` 的 `SYSTEM_PROMPT` 第 18 条，明确支持散落药片、混装与整板药片识别。

**Step 4: 运行测试确认通过**

Run: `npx vitest run tests/pillCounter.test.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add src/ai/tools/pillTools.ts src/ai/assistant.ts src/ui/assistantContent.ts src/ui/AiAssistant.ts tests/pillCounter.test.ts
git commit -m "feat(ai): wire count_pills tool to new pipeline and interactive preview cards"
```

---

### Task 9: Cloudflare Pages Binding 说明、本地基准验证脚本与文档同步

**Files:**
- Create: `scripts/bench-pills.mjs`
- Modify: `docs/handoffs/claude.md`
- Modify: `docs/handoffs/CURRENT.md`

**Step 1: 编写本地真机样本评估脚本**

创建 `scripts/bench-pills.mjs`（读取本地传入的真实照片目录，依次对比本地新算法与指定端点输出，打印耗时与检出颗数，无副作用、不把个人照片提交进仓库）。

**Step 2: 跑通脚本帮助检查**

Run: `node scripts/bench-pills.mjs --help`
Expected: 打印用法说明并以 0 退出。

**Step 3: 整理 Cloudflare 生产环境绑定清单与交接文档**

1. 在 `docs/handoffs/claude.md` 与 `docs/handoffs/CURRENT.md` 明确记录：
   - 本期改动范围、测试结果；
   - 上线前必须在 Cloudflare Pages 控制台 **Settings → Functions → Bindings** 添加 Workers AI 绑定（变量名 `AI`），否则 `/api/count-pills` 将安全返回 `503 AI_NOT_BOUND` 并自动走本地校准兜底；
   - 二期离线 YOLO 可选下载包的接入点位置（`registerLocalYoloProvider`）。

---

### Task 10: 全量质量门禁（不擅自发版，确认后再决定是否发布）

**Step 1: 类型检查与全量单元测试**

Run: `npm run typecheck && npm test`
Expected: 0 类型错误，全量 Vitest 测试通过。

**Step 2: 浏览器多视口 E2E 门禁**

Run: `npx playwright test e2e/pill-counter.spec.ts e2e/camera-actions.spec.ts`
Expected: 4 个视口（phone-320 / phone-390 / tablet-landscape / desktop）全绿通过；再跑全量 `npx playwright test` 确保无回归。

**Step 3: Web 产物构建与发版策略确认**

Run: `npm run build:web`
Expected: 构建成功且生成 `dist/`；若准备推送远程仓库与发布版本，严格按 `medbox/AGENTS.md` 执行 `release:bump` / `docs/releases/X.Y.Z.md`（经 `tone_lint.py` 校验、短小无黑话）/ `release:build` / `release:publish`。
