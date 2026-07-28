# UI 审查脚本

本目录存放一次性或手动运行的页面审查脚本，不参与生产构建。

## 运行约定

请从仓库根目录运行，脚本会把截图、JSON 和 HTML 报告写入根目录的 `output/`（该目录已加入忽略规则）：

```powershell
node scripts/ui-audit/ui-audit-all-pages.mjs
node scripts/ui-audit/ui-audit-layout-check.mjs
node scripts/ui-audit/ui-audit-interactions.mjs
```

Python 脚本 `ui-audit-recon.py` 需要在已安装 Playwright 的 Python 环境中运行。

## 文件说明

- `ui-audit-all-pages.mjs`：遍历页面并收集基础截图/控制台信息
- `ui-audit-layout-check.mjs`：检查不同视口下的布局
- `ui-audit-interactions.mjs`：检查页面交互
- `ui-audit-recon.mjs` / `ui-audit-recon.py`：页面结构和视觉复核
- `ui-audit-settings-ai-panel.mjs`：设置页 AI 面板复核
- `ui-audit-today*.mjs`：今日页数据和交互复核
- `ui-audit-debug-acc.mjs`：辅助调试
