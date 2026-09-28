# 审查运行状态可见性

2026-09-28。

## 语义

任务提交或手动 review start → pending_review；执行器收到 Codex thread.started 回执 → reviewing。会话 UUID 和 review_running 历史随状态在同一事务中登记，重复或过期回执不会回退已完成任务。

pending_review / reviewing 均不放行完整依赖、不发送完成通知，保持要求和完成条件冻结。正常交卷后发送一次 pass/reject；受阻、执行器异常、超时沿用已有提醒。blocked_from=pending_review 表示需重启审查，restart 始终回到排队阶段。

旧版本仍在运行的审查，由新版监控器确认会话、worker 和 child 均存在后接续显示 reviewing，不新建轮次或重启 reviewer。只读查询不迁移状态。

## 验证

- review、blocked、资源 CLI 回归：27/27 通过。
- 增补旧线程接续及异常恢复验证：3/3 通过。
- 覆盖 HTML「审查中」标签与筛选、CLI reviewing 筛选、启动无通知、幂等回执、最终单次通知、审查条件冻结、异常退出及恢复。
- build、skill validate、git diff --check 通过。
- unity-try 的 T-0107 实际接续：轮次 e4022cf6-468a-4ba9-a9d6-ec71c52afaf3、会话 01a0e598-2aa0-76e1-8e21-bda916b8abed 保持；worker 40932、Codex 49180 仍存活。仅后台 supervisor 更换为新版 42664。任务 Markdown 和生成 HTML 数据均为 reviewing。

本地测试日志：output/reviewing-tests.log。
