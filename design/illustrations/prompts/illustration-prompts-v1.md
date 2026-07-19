# 小药盒 空状态与引导插画提示词 v1

来源：`docs/plans/2026-07-14-medbox-0.7.0-ui-and-medication-batch.md` 第 8 节。

- 生成工具：Agnes Image 2.1 Flash（`agnes-image-2.1-flash`），文生图。
- 通用风格（计划原文）：透明 PNG，1024x768，主体居中，20% 安全留白，柔和浅色纸艺/半扁平二维，白色、雾蓝、薄荷绿和少量珊瑚色，短而轻的阴影；无文字、数字、Logo、人物、药品品牌、渐变光球、散景和复杂背景。
- 该工具不支持原生透明，按计划替代方案生成完全平坦 `#FF00FF` 背景，后期色键抠图。
  为保证可抠图，所有阴影约束为只出现在纸艺元素相互之间，不得投射到背景上。
- 尺寸：`size: 2K` + `ratio: 4:3`（输出 2304x1728），master 保留高分辨率，生产阶段再缩放到显示尺寸。
- 实际发送的提示词为同目录 `*.en.txt` 文件内容；下方中文块为计划原文存档。

## 8.1 无药品（empty-medications）

```text
Use case: stylized-concept
Asset type: 中文药品管理页面空状态插画
Primary request: 一个简洁的七日分格药盒、一张无文字日历页和小型完成标记，表达“尚未录入药品”。
Style: 柔和浅色纸艺、半扁平二维、清爽可信。
Composition: 横向 4:3，主体集中在中部，四周留白，适合在 240px 宽区域显示。
Constraints: 无药名、无文字数字、无人物、无品牌、无红十字、无水印。
```

发送文件：`empty-medications.en.txt`

## 8.2 扫码引导（scan-guide）

```text
Use case: stylized-concept
Asset type: 扫码识药页面拍照引导插画
Primary request: 一部手机相机取景框、两个无品牌药盒和四角对焦标记，正面平视，表达“把药盒完整放入取景框”。
Style: 与其他空状态一致，轮廓清楚，背景透明。
Composition: 横向 4:3，药盒不被裁切，取景框内留出明显边缘。
Constraints: 无可读包装文字、无药品品牌、无人物、无医疗徽标、无水印。
```

发送文件：`scan-guide.en.txt`
