# 文件绑定、摘要与 reference 标签
## 背景和目标
工具已有 content/report/log/handoff 标签。为后继提供专用接入资料，新增 reference attach，并使各附件可选 summary 从 CLI 经 Markdown 持久化到 HTML。接手者先读同目录 design.md 的范围、实现约定与定位。
## 交付范围
实现 task reference attach --path [--title] [--summary] [--snapshot]；report/log/handoff attach 与 handoff create 支持 summary。reference 默认跟随当前文件，可冻结；摘要可直接说明符号或章节位置，无新 locator/read_when 字段。旧任务不迁移仍可读取。
本任务实现自身 reference 列表与摘要呈现；依赖收集由后续任务消费既有登记完成。支持源代码文本以转义 pre 展示，保持路径 containment 和 Markdown 安全策略。
GitHub reference 只列索引与摘要，既有附件评论增加摘要且保持去重。
## 验收
临时项目绑定多个类别，可从序列化/重载读取 summary；live 原文件更新可见、snapshot 不变；路径越界拒绝；HTML 列表路径摘要可读且内容安全；GitHub 模拟接口不把 reference 源码发布为评论。
## 定位与运行
完整入口索引和测试命令见 design.md。文档模型在 src/core/task.ts 与 documents.ts，类别 UI 在 viewer-client.ts 的 documentsFor/tabsFor/renderDocumentPanel。
## 交付
写 docs/work/reference-context/attachments-report.md 和 attachments-reference.md，后者包含实际代码入口与接口约定；完成时注册为 reference，供下一任务消费。
