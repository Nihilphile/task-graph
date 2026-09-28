# blocked / review / error-book 集成交付

日期：2026-09-28。

## 行为

- 人工 block 持久化 `status: blocked`，保存 `blocked_from` 和领取。多条原因全部解除后恢复原阶段；恢复 reject 不重复产生验收通知。
- 仅依赖未完成仍由 readiness 表达；人工等待与审查异常在节点上直接显示「受阻」。旧 manual_blockers 读取时兼容为 blocked，读取和构建不改写任务源文件。
- 执行者仍调用 complete。开启 auto-review 时工具进入 pending_review，审查 pass → done，reject → reject，无法验证或执行器异常 → blocked。审查阻塞使用 review restart 恢复 pending_review。
- 审查期间冻结要求绑定、依赖、子图完成条件；普通 start / complete / unblock 不能绕过审查。
- 独立审查 reject 必须同时提交 `--error-report`，可复用包含复盘的验收报告。报告、复盘及历史在同一事务保存；错题本从历史投影，每轮只追加一次。验收证据指向不可变快照。
- pass、审查 blocked、执行器异常不产生错题条目。原有通知 ID 兼容修复保留。

## 验证记录

测试日志位于独立开发工作区 `task-graph-auto-review/output/`，属于本地运行产物。

- 首轮全量：273 项，267 通过，6 项失败。失败均为新增 blocked 后需更新的旧测试：不支持状态示例使用了 blocked（2 项），人工阻塞仍期待 todo（3 项），新阻塞历史未注入固定时钟（1 项）。
- 修复后定向回归：36 项中 35 通过；剩余 HTML 筛选断言随后修复，并在下一轮验证通过。包含 5 项 blocked 新用例，以及 review、watch、投影回归。
- 最后状态解析、校验、HTML 筛选回归：34/34 通过（覆盖剩余失败）。
- 合并原工作区最新 errorbook 资源命名后，CLI 资源与 error-book 回归：13/13 通过。
- TypeScript build、skill validate 通过。全量失败项均已在后续针对性运行中通过；未把多轮结果表述为一次全量通过。
- 两个独立代码审查分别核查规格和仓库约定；修复其指出的重复通知、审查条件变更旁路、错题证据快照问题。

## 真实 Codex 执行

独立测试项目：`output/blocked-review-real`，未绑定桌面订阅。

- 任务 T-0001，RR 要求 answer.txt 为 42，实际交付为 41。
- 人工 block → blocked，unblock → in_progress，complete → pending_review。
- 实际启动 gpt-6-sol / xhigh，审查会话 `01a0e556-42dc-74b3-9535-9edd8840f245`。
- 审查者自主调用 review finish reject 并提交 error-report，任务最终 reject，进程退出码 0，错题本产生 1 条带复盘快照的记录。
- 该实跑发生在证据链接修复之前；之后新增用例覆盖“覆盖原报告仍能读取原证据快照”。没有修改历史实跑数据来伪装修复后的结果。

## 安装方式

合入原工作区后在原目录重新构建 dist。task-graph、task-take、to-task、to-active-task 的现有安装为目录联接，沿用这些入口；新建的独立审查随后使用正式 CLI。远端推送不在本轮范围内。
