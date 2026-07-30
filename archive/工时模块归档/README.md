# 工时模块源码归档

此目录保存“小药盒”移除工时功能前的实现快照，供后续创建独立工时 App 时参考。它不是可直接运行的项目，不包含依赖、构建产物或原应用的药品数据。

## 来源

- 原项目：`medbox`
- 原始提交：见 `SOURCE_COMMIT.txt`
- 原 IndexedDB：`medbox-work`
- 原本地偏好键：`medbox.lastWorkEntry`

## 主要文件

- `src/pages/WorkLog.ts`：工时记录、档案、结算和导出界面。
- `src/db/work.ts`：`medbox-work` 数据库、导入导出和班次原子操作。
- `src/domain/workIncome.ts`：时薪、日薪、月薪和结算计算。
- `src/ui/styles/pages/work.css`：工时页面样式。
- `tests/work*.test.ts`：收入、生命周期、并发开始和 UI 契约测试。
- 带 `.original.ts` 后缀的文件：保留工时类型、备份、安全校验和 AI 工具的原始上下文，后续应只抽取工时相关部分。

## 原数据结构

原备份使用三个字段：`workProfiles`、`workEntries`、`workSettlements`。数据库包含同名 object store，版本为 2。创建新 App 时建议保留这些字段名称作为导入兼容层，但使用新的应用包名、数据库名和本地偏好键，避免与“小药盒”共享运行身份。

## 后续独立 App 建议

1. 新建独立 Vite/Capacitor 项目并确定新的包名。
2. 移植 `schema.original.ts` 中的工时类型，再接入 `db/work.ts` 和 `domain/workIncome.ts`。
3. 移植 `WorkLog.ts`、相关 UI primitives 和 `work.css`。
4. 将原 AI 工时工具从 `assistantTools.original.ts` 拆成独立工具注册表。
5. 为旧备份提供显式导入入口；“小药盒”升级后会删除原设备上的 `medbox-work` 数据库，因此不能依赖跨 App 直接读取旧 WebView 存储。
6. 运行归档测试并补充新 App 的路由、备份、Android 安装和迁移测试。
