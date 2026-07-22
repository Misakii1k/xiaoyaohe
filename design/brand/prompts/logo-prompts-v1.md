# 小药盒 Logo 生图提示词 v1

来源：`docs/plans/2026-07-14-medbox-0.7.0-ui-and-medication-batch.md` 第 7.1–7.2 节。

- 生成工具：Agnes Image 2.1 Flash（`agnes-image-2.1-flash`），文生图。
- 每条提示词单独生成 2 个候选（多次单张调用，不生成拼图/联系表）。
- 该工具不支持原生透明输出，按计划采用完全平坦 `#FF00FF` 背景，后续色键抠图。
- 尺寸：`size: 2K` + `ratio: 1:1`（输出 2048x2048，直接满足 7.4 节 2048px master 源尺寸）。
- 实际发送的提示词为下方各方案的 "EN prompt (sent)" 区块；中文块为计划原文，仅存档。

## 方案 A：模块工具箱（首选）

### 计划原文（存档）

```text
Use case: logo-brand
Asset type: “小药盒”移动应用的 Logo 图形标记和 Android 启动图标
Primary request: 设计一个极简、原创、容易记忆的模块化药盒标记。四个圆角模块组合成一个紧凑的药盒或立方体，负空间中非常含蓄地形成一个日程勾选，表达药品提醒、每日分药和库存管理。
Style/medium: 扁平二维、矢量友好、几何轮廓清晰、现代中文效率工具气质，不做拟物和玻璃效果。
Composition: 单个居中图形，正方形构图，主体占画布 62%-68%，四周安全留白一致；缩小到 24px 仍能辨认轮廓。
Color palette: 深雾蓝 #3168D5 为主，薄荷绿 #6CBFA3 为辅助，最多加入一个小面积珊瑚色 #E27A72；必须同时提供良好的单色轮廓。
Background: 原生透明；若不支持透明，使用完全均匀的纯 #FF00FF 背景，不得有阴影、渐变、纹理、反射或地面。
Constraints: 无文字、无字母、无数字、无商标、无红十字、无药品品牌、无水印；不要药丸占据主体；不要细线、复杂细节、3D、发光、光球或散景。
```

### EN prompt (sent)

```text
Minimalist original logo mark for a daily-life toolbox mobile app. Four rounded-corner
geometric modules assemble into one compact open toolbox / cube shape; the negative space
between the modules subtly suggests a checkmark tick. Flat 2D vector style, clean bold
geometry, modern productivity-tool character, no skeuomorphism, no glass effect.
Single centered mark, square composition, the mark occupies about 65% of the canvas with
even margin on all sides, silhouette must stay readable at very small icon size.
Color palette strictly: deep blue #3168D5 as dominant color, mint green #6CBFA3 as
secondary, at most one small coral #E27A72 accent shape.
Background: one single completely flat solid magenta color #FF00FF filling the entire
canvas edge to edge, absolutely uniform, no gradient, no vignette, no texture, no ground
plane, no reflection, and the mark casts no shadow onto the background.
Strictly no text, no letters, no numbers, no typography, no trademark, no red cross, no
pill as the main subject, no watermark, no thin fragile lines, no intricate detail, no 3D,
no glow, no bokeh.
```

## 方案 B：日程模块

### 计划原文（存档）

```text
Use case: logo-brand
Asset type: “小药盒”应用图形标记
Primary request: 一个由三个圆角模块和一个简洁勾选缺口组成的抽象日程工具标记，外轮廓隐约像收纳盒，表达每天安排、记录和完成，不偏向单一医疗功能。
Style/medium: 扁平二维、矢量友好、克制、可信、轮廓饱满。
Composition: 单一居中图形，正方形，主体覆盖 65%，适配圆形和圆角方形裁切。
Color palette: #3168D5、#6CBFA3、白色；不得使用紫色主导渐变。
Background: 原生透明，或完全均匀的纯 #FF00FF 抠图背景。
Constraints: 无文字、字母、数字、人物、药品品牌、水印、细碎纹理、投影和复杂渐变；16px 时轮廓仍清楚。
```

### EN prompt (sent)

```text
Abstract daily-schedule tool logo mark built from exactly three rounded-corner blocks plus
one clean checkmark notch cut out of a block; the overall outer silhouette faintly reads
as a storage box. Expresses planning, recording and completing everyday tasks, not a
medical-only product. Flat 2D vector style, restrained, trustworthy, full generous
shapes with bold silhouette.
Single centered mark, square composition, mark covers about 65% of the canvas, silhouette
safe for circle and rounded-square cropping, still readable when tiny.
Color palette strictly: deep blue #3168D5, mint green #6CBFA3 and white only. No purple,
no dominant gradient.
Background: one single completely flat solid magenta #FF00FF across the whole canvas,
perfectly uniform, no gradient, no texture, no shadow cast on it, no ground.
Strictly no text, no letters, no numbers, no human figures, no medicine branding, no
watermark, no fine grain texture, no drop shadow, no complex gradient, no 3D, no glow.
```

## 方案 C：连续工具带

### 计划原文（存档）

```text
Use case: logo-brand
Asset type: 中文日常效率工具应用 Logo
Primary request: 用一条连续的宽色带折叠成简洁的工具箱轮廓，内部负空间形成一个小型时间刻度和完成缺口，体现连续记录、提醒和多功能模块。
Style/medium: 极简扁平几何、矢量友好、没有写实材质。
Composition: 单个居中标记，结构对称但不呆板，主体占 64%，保留 Android adaptive icon 安全区。
Color palette: 主色 #3168D5，辅助 #6CBFA3，少量 #E27A72。
Background: 原生透明，或完全均匀的纯 #FF00FF 抠图背景。
Constraints: 无文字、无字母、无数字、无品牌、无红十字、无水印、无 3D、无发光、无背景装饰。
```

### EN prompt (sent)

```text
Logo mark formed by one single continuous wide ribbon band folding into a simple toolbox
silhouette; the interior negative space forms a small tick-mark notch suggesting time
marks and completion. Expresses continuous recording, reminders and modular tools.
Ultra-minimal flat geometric style, vector-friendly, no realistic material, no texture.
Single centered mark, square composition, structurally balanced but not rigid, mark
occupies about 64% of the canvas with generous safe margin suitable for Android adaptive
icon cropping.
Color palette strictly: dominant deep blue #3168D5, secondary mint green #6CBFA3, a small
amount of coral #E27A72.
Background: one single completely flat solid magenta #FF00FF over the entire canvas,
absolutely uniform, no gradient, no decoration, no shadow on the background.
Strictly no text, no letters, no numbers, no branding, no red cross, no watermark, no 3D,
no glow, no background ornament.
```
