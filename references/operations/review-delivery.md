# 审查的验收对象

用于选择/理解 snapshot 与 live 两种模式。

默认 `snapshot`：在提交/手动启动时复制工作文件，记录每个文件的 SHA-256 和权限，包含 Git 跟踪文件的实际修改和未忽略的新文件。副本建立独立 Git 仓库和捕获提交，避免 Git 检查向上找到原项目；原项目 HEAD 另行记录，原 Git 历史、remotes 和 hooks 不复制。Git 项目以仓库根目录为项目目录；Git 忽略的依赖、缓存不复制。符号链接和子模块不静默复制，无法固定时返回明确错误。非 Git 项目复制普通工作文件，排除 `.task-graph`、`.git`、`node_modules`、Unity `Library/Temp/Logs` 和 `obj`。

审查者在副本中运行验证，可能需要安装依赖；不足以验证时提交 blocked。日志、报告和任务图回写在原项目 `.task-graph` 下。工具使用 Codex 的 workspace-write 与非交互审批配置，未绕过 sandbox；模型和宿主环境须支持所需操作。

Unity 等需要现场的任务显式配置 `--mode live`。工具记录现场文件指纹，审查报告记录实际环境、测试房和占用；源码发生变化时拒绝 pass/reject，可提交 blocked。文件指纹不能冻结正在运行的场景或外部服务，主控仍需协调现场。重启沿用同一验收对象，不自动接受新版本；源码漂移后可恢复原文件再重启；若已 blocked 且需要修改交付，由主控安排 start/reopen/claim/reassign 接手修复，进入 in_progress 后再改动并 complete，重新捕获交付。仍在 pending_review/reviewing 的审查不能直接接管。
