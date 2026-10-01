# CLI 命令目录

仅在核对旧命令或维护工具时读取。日常用 `<资源地址> describe` 查询当前动作。

| 命令 | 作用 |
| --- | --- |
| `init` | 创建 `.task-graph/`；使用 `--task` 时同时创建入口图和根任务 |
| `graph add` | 用 `--entry` 创建入口图，或用 `--parent-task T-NNNN` 创建子图 |
| `graph publish` | 为已有入口图开启 GitHub 自动发布；后续任务继承 |
| `graph watch` | 显式订阅 Desktop 后续轮结果通知，或查看状态、恢复投递 |
| `graph unwatch` | 取消图与会话订阅，取消尚未投递的通知 |
| `github sync` | 补发启用图的待同步内容，并刷新 HTML 状态 |
| `task add` | 通过摘要、要求路径和依赖数组创建任务；支持 `--from` 批量事务和稳定 key |
| `task revise` | 原地修订任务；使用 `--replace` 时取消旧任务并创建替代任务 |
| `task refine` | 主控确认动态任务输入充分，记录放行依据；暂停指纹校验 |
| `task unrefine` | 撤销尚未执行的动态任务放行，要求重新评估 |
| `task content attach` | 增量绑定一份 live 要求文件，支持摘要 |
| `task content remove` | 解除要求绑定，保留文件与历史；不能移除最后一份要求 |
| `task log` | 追加默认工作记录；旧任务已有的正文工作记录继续可用 |
| `task report attach` | 附加一份报告，保留交付快照 |
| `task log attach` | 附加独立的工作记录文件 |
| `task handoff attach` | 附加独立交接文件，保留交付快照 |
| `task handoff create` | 保存当前要求正文与附件索引，避免复制报告或历史全文 |
| `task reference attach` | 通过 R-ID 复用代码入口条目 |
| `task output add` | 登记项目根目录相对路径的结构化产物；文件可稍后创建 |
| `task output remove` | 移除指定路径的产物记录（包括同路径多个版本），保留文件 |
| `task output set-audience` | 标记同一来源路径所有附件版本为 agent 或 user，保留快照 |
| `task list` | 从源文件列出任务、状态、就绪状态与阻塞原因；支持 `--json` 和筛选 |
| `task show` | 默认查看事实和文件清单；按类别/路径显式展开，支持预览体量与路径排除 |
| `task start` | 将就绪待办或可接手的 blocked 任务改为 in_progress；已完成任务须显式重新打开 |
| `task complete` | 提交交付并结束领取；已启用自动审查时进入 pending_review，普通任务进入 done；复合任务须满足完成目标 |
| `task reject` | 保存验收未通过结果和报告，释放领取但不满足依赖 |
| `task record-error` | 记录实际返工或额外步骤到错题本，不改变任务状态与领取 |
| `task cancel` | 取消 `todo`、`in_progress` 或人工 `blocked` 任务；`cancelled` 为终态 |
| `task reopen` | 将 done/reject 重新打开，或接手 blocked 修复，成功后进入 in_progress |
| `task claim` | 记录领取角色、`session_id` 和 `claimed_at` |
| `task release` | 显式清除当前领取 |
| `task reassign` | 重派或通过 `--takeover` 接管任务，并保留领取历史 |
| `task link` | 建立完全依赖；用 `--gate` 建立指向复合任务完成点的部分依赖 |
| `task unlink` | 移除指定依赖 |
| `task block` | 保存 blocked 状态与人工阻塞原因，保留原阶段和领取 |
| `task unblock` | 移除一个人工阻塞原因；最后一个移除后恢复原阶段 |
| `task attach-subgraph` | 将已注册的非入口图附加到任务 |
| `task set-completion` | 设置复合任务的完成目标 |
| `task expose-gate` | 公开供部分依赖使用的命名完成点 |
| `source add` | 登记可选的 PRD 来源及确认时间 |
| `validate` | 报告结构问题及对应文件、字段 |
| `build` | 重新生成 `graph.json` 和 `index.html` |
| `skill validate` | 核对本 Skill 文档与实际注册的 CLI 命令 |
| `help` | 查看命令列表或单个命令的用法 |
| `task review-requirement attach` | 绑定验收要求文件，支持多文件与摘要 |
| `task review-requirement remove` | 移除 RR 绑定，已开启审查时保留有效 RR |
| `task auto-review enable` | 启用任务自动审查，可保存执行配置 |
| `task auto-review disable` | 显式关闭任务自动审查 |
| `task auto-review status` | 查看任务有效审查配置 |
| `graph auto-review enable` | 扫描有有效 RR 的任务，保留显式关闭 |
| `graph auto-review status` | 查看本图任务的审查配置 |
| `review configure` | 配置项目级审查默认值 |
| `task review configure` | 配置任务的模型、推理与交付模式 |
| `task review start` | 对已完成任务手动启动独立审查 |
| `task review finish` | 按本轮身份提交报告与 pass/reject/blocked |
| `task review restart` | 异常或 blocked 后对相同交付重新审查 |
| `task review status` | 查看轮次、日志、进程和报告 |
| `task review recover` | 核对异常退出或中断的运行记录 |
| `contract add` | Create one shared current contract node |
| `contract update` | Update the authoritative text of a contract |
| `contract list` | List contract entries |
| `contract show` | Read contract entries |
| `reference list` | List reference entries |
| `reference show` | Read reference entries |
| `reference add` | Register or reuse a code entry and optionally bind it to the selected owner |
| `task reference add` | Register or reuse a code entry and optionally bind it to the selected owner |
| `contract reference add` | Register or reuse a code entry and optionally bind it to the selected owner |
| `reference update` | Update one shared code navigation entry |
| `task contract attach` | Bind an existing contract ID |
| `task contract remove` | Unbind an existing contract ID |
| `task contract list` | List current contracts or reusable code entries for this owner |
| `task reference remove` | Unbind an existing code reference ID |
| `task reference list` | List current contracts or reusable code entries for this owner |
| `contract reference attach` | Bind an existing code reference ID |
| `contract reference remove` | Unbind an existing code reference ID |
| `contract reference list` | List current contracts or reusable code entries for this owner |
| `decision record` | Atomically record a decided contract, completed decision task and consumer bindings |
