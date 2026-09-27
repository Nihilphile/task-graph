# 独立审查交付记录

日期：2026-09-28。实现位于 `task-graph-auto-review` 工作区、`codex/auto-review` 分支；原工作区和已安装 skill 入口未切换。本记录不表示已推送或发布。

## 已实现

- 独立、多文件 `review-requirement` 标签及摘要，CLI、context 和 HTML 均提供入口。
- 任务自动审查开关；图级一次扫描，区分无 RR、无效 RR、已开启与显式关闭。
- 自动流程：执行者 `complete` → `pending_review` → 独立审查；执行 claim 释放，完整依赖等待审查通过。
- 手动流程：主控读完交付、绑定 RR 后执行 `.review start`，无需启用自动审查。
- `codex exec` 默认 `gpt-6-sol` / `xhigh`，项目、任务和调用均可配置；不同任务独立运行，同一任务防止重复启动。
- 审查者通过 `.review finish` 绑定本轮报告，提交 pass / reject / blocked；订阅按有效结论或运行告警通知主控。
- 进程退出但未交卷会告警；已交卷再异常退出保留有效结论。restart 保留原交付及要求，旧轮次不能回写新轮次。
- 固定交付包含未提交修改及未忽略的新文件；快照使用独立 Git 仓库，保留权限。现场模式记录文件指纹并拒绝源码漂移后的 pass/reject。
- 执行器恢复检查、超时提醒、日志、会话 ID、受影响后继，以及 skill 能力声明和命令索引已同步。

使用方式见 [独立审查手册](../../references/review.md)。设计依据见 [设计记录](auto-review-design.md) 和 [手动审查依赖 ADR](../adr/0001-manual-review-and-dependencies.md)。

## 验证

- 定向回归：30/30 通过，覆盖审查、原通知机制、资源语法和 skill 校验。日志：`output/auto-review-targeted.log`。
- 最终全量回归：`npm test` 完成 TypeScript 构建，264/264 通过，0 失败、0 跳过；耗时约 360 秒。日志：`output/auto-review-final-test.log`。
- 新增 10 个审查测试，覆盖多 RR、图扫描、依赖门禁、幂等交卷、blocked/restart/过期回写、快照与现场、死进程、实际子进程、交卷后异常退出、部分事务恢复与多任务并行。

### 真实 Codex 执行

实测项目：`output/auto-review-real-smoke`。使用本机 `codex-cli 0.157.1`、`gpt-6-sol` / `xhigh`，从启用 auto-review 的任务 `complete` 自动拉起审查者。审查者读取固定材料、检查 `answer.txt` 为 42、产出报告并成功调用 `.review finish`；最终任务为 done、审查为 pass。

- 审查轮次：`4b27e70c-a2d8-4140-8efd-a10d9ee74fcf`。
- Codex 会话：`01a0e50f-0599-7d11-aa97-3ec6a04d3b1d`。
- [真实审查报告](../../output/auto-review-real-smoke/.task-graph/reviews/4b27e70c-a2d8-4140-8efd-a10d9ee74fcf/report.md)。该链接依赖当前本机保留的输出目录，不随 Git 发布。

该次真实模型运行在后续 Git 隔离与原生进程入口修复之前；修复由定向回归及本机原生程序版本检查验证。真实运行未绑定 Desktop 订阅；通知行为由测试适配器验证，未宣称本次已经完成真实桌面通知投递。

## Standards

独立审查发现 1 项：复制交付未保留文件执行权限。已修复复制和指纹记录，并验证兼容旧运行记录。复查未发现明确的仓库标准违规或高置信度结构问题。

复查另提示 spawn 与保存 PID 之间的失败窗口：已在提示词发送前增加子进程清理，防止持久化失败留下无记录执行者。

## Spec

独立审查发现 2 项：快照未建立独立 Git 边界；图重复扫描未重新验证已开启任务的 RR。均已修复并增加验证。复查同时检查了恢复逻辑在事务内重读状态，避免把正常 finish 的中间观察误判为失败；无新增明确缺口。

两轴结论：Standards 原有 1 项、Spec 原有 2 项均已修复；未留存上述未解决项。

## 使用边界

- 本次只在隔离工作区开发及本地提交，不切换现有安装、不推送远端。
- 执行器不是系统服务：机器整体退出后，要由下一次修改命令或显式 recover 恢复监控；超时提醒不强杀进程。
- Git 历史、remotes、hooks 和忽略的依赖不复制。验证缺环境时审查者应提交 blocked。
- 本版没有审查中撤回或修改交付流程。live 模式源码漂移后恢复原文件再 restart，或由主控建立替代任务表达新交付。
- 运行账本及日志属于本机 `.task-graph/review.json` / `.task-graph/reviews/`，不随 Git 自动迁移；最终报告仍保存为任务附件快照。
