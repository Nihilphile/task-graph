# 独立审查

CLI 表示 `node "<本工具目录>/dist/src/cli.js"`。每次调用带 `--cwd "<项目根目录>"`，自动化调用加 `--json`。本功能由当前目录的程序执行；开发工作区不会替换其他项目正在使用的安装入口。

## 要求与两种启动方式

`review-requirement`（RR）是独立的验收要求标签，支持多份 Markdown/text 文件及 summary。content 表达任务目标和约束；RR 表达验收条件、检查方法及证据要求。两者共同约束审查。start/show 的 `context.review_requirements` 返回 RR 入口；HTML 点击「验收要求」先显示清单。

自动审查在开工前确定 RR 并开启：

```text
CLI 'task[T-0001].review-requirement' attach --path docs/tasks/check.md --summary "行为与边界验证" --cwd <项目> --json
CLI 'task[T-0001].auto-review' enable --cwd <项目> --json
CLI 'task[T-0001]' start --role implementer --session-id <会话ID> --cwd <项目> --json
CLI 'task[T-0001]' complete --report docs/reports/implementation.md --cwd <项目> --json
```

启用后，complete 提交交付并进入 `pending_review`，释放执行 claim，自动启动审查。收到 Codex 的 `thread.started` 回执后，程序记录审查会话并自动转为 `reviewing`（审查中）；审查者无需额外操作。它不会提前判为 done；普通 reject 也不能绕过审查入口。执行者提交后结束自己的工作，审查者负责本轮验收。

手动审查适用于未启用自动审查的任务：先按原流程完成任务，主控读完报告再绑定 RR，并执行：

```text
CLI 'task[T-0001].review' start --cwd <项目> --json
```

手动 start 将 done 转为 pending_review，阻塞尚未开始的完整依赖；已开始的后继继续运行。部分完成点保持仅检查指定子任务的语义。手动启动不改变 auto-review 开关。

两种方式都要求存在有效、非空且 agent 可读的 RR。已开启时不能移除最后一份有效 RR，先用 `.auto-review disable` 关闭。审查期间要求绑定固定，本版不提供撤回或改要求的流程。

## 图扫描与配置

```text
CLI 'graph[G-001].auto-review' enable --cwd <项目> --json
CLI 'graph[G-001].auto-review' enable --recursive --cwd <项目> --json
CLI 'graph[G-001].auto-review' status --cwd <项目> --json
CLI 'task[T-0001].auto-review' disable --cwd <项目> --json
```

这是一次扫描，不是持续继承。返回 enabled、already_enabled、missing_rr、invalid_rr、explicitly_disabled 或状态导致的 skipped。显式关闭的任务保持关闭；单独 enable 可重新开启。新增任务或补齐 RR 后可再次扫描。

默认使用 `gpt-6-sol` / `xhigh`，不同任务独立启动，不设工具级并发上限；同一任务只能有一个有效运行。模型不可用时报告异常，不自动换模型。

```text
CLI review configure --model gpt-6-sol --reasoning xhigh --cwd <项目> --json
CLI 'task[T-0001].review' configure --mode live --cwd <项目> --json
CLI 'task[T-0001].auto-review' enable --model <模型> --reasoning high --cwd <项目> --json
CLI 'task[T-0001].review' start --model <模型> --reasoning xhigh --cwd <项目> --json
```

配置优先级：本次调用 > 任务配置 > 项目默认 > 内置默认。status 返回有效配置；每轮保存自己的配置。可选 `--executable <绝对路径>` 指定真实 codex 可执行文件（不接受 PowerShell/batch shim）；可选 `--timeout-minutes`，默认 60 分钟后提醒但不杀进程或自动判 reject。

## 验收对象

默认 `snapshot`：在提交/手动启动时复制工作文件，记录每个文件的 SHA-256 和权限，包含 Git 跟踪文件的实际修改和未忽略的新文件。副本建立独立 Git 仓库和捕获提交，避免 Git 检查向上找到原项目；原项目 HEAD 另行记录，原 Git 历史、remotes 和 hooks 不复制。Git 项目以仓库根目录为项目目录；Git 忽略的依赖、缓存不复制。符号链接和子模块不静默复制，无法固定时返回明确错误。非 Git 项目复制普通工作文件，排除 `.task-graph`、`.git`、`node_modules`、Unity `Library/Temp/Logs` 和 `obj`。

审查者在副本中运行验证，可能需要安装依赖；不足以验证时提交 blocked。日志、报告和任务图回写在原项目 `.task-graph` 下。工具使用 Codex 的 workspace-write 与非交互审批配置，未绕过 sandbox；模型和宿主环境须支持所需操作。

Unity 等需要现场的任务显式配置 `--mode live`。工具记录现场文件指纹，审查报告记录实际环境、测试房和占用；源码发生变化时拒绝 pass/reject，可提交 blocked。文件指纹不能冻结正在运行的场景或外部服务，主控仍需协调现场。重启沿用同一验收对象，不自动接受新版本；源码漂移后可恢复原文件再重启；若已 blocked 且需要修改交付，由主控安排 start/reopen/claim/reassign 接手修复，进入 in_progress 后再改动并 complete，重新捕获交付。仍在 pending_review/reviewing 的审查不能直接接管。

## 审查者交卷

工具生成默认提示词，提供本轮任务、固定材料清单、交付目录、报告路径与提交命令。审查者按 RR 和明确约束逐项记录实际验证证据，额外风格或重构建议单列。

```text
CLI 'task[T-0001].review' finish --review-id <本轮UUID> --result pass --report <项目相对报告路径> --cwd <项目> --json
```

result 可为 pass / reject / blocked。pass 将任务置为 done；reject 保持依赖阻塞；缺环境、材料或判据时 blocked，将任务设为 `blocked` 并通知主控；原交付重审用 review restart 回到 pending_review；若要进入任务施工修复，先 start 接手到 in_progress。reject 还必须传 `--error-report <Markdown文件>`，写明失败、失败模式及原因或改进，和结论一起追加到 [error-book](error-book.md)。验收报告已有简短复盘时两参数可指同一文件；pass/blocked 不传 error-report。空报告不接受；每轮报告和快照保留。重复提交相同报告与结果幂等，旧轮次不能改写新轮次。

有效结果以 `.review finish` 成功为准，进程退出码和聊天结语不替代交卷。报告、状态和通知事件在同一次项目事务中保存；现有文件事务仍需在进程/系统中断后核验持久状态。

## 监控、恢复与通知

```text
CLI 'task[T-0001].review' status --cwd <项目> --json
CLI 'task[T-0001].review' recover --cwd <项目> --json
CLI 'task[T-0001].review' restart --cwd <项目> --json
```

后台执行器隐藏启动，分别监控每个审查进程。进程退出而没有 finish 时记录 failed，将任务设为 blocked 并告警；先成功 finish 后异常退出则保留结论，记录运行异常。状态包含轮次、会话 ID、日志与错误地址。

执行器或机器整体退出后，下一次修改命令会重新启动监控；可用 recover 主动核对死进程。restart 只用于 failed/blocked 且旧进程已退出的情况，创建新轮次并保留同一交付/RR。仍可能存活的旧进程会阻止重启；先核查日志和进程。接手修复同样要求旧审查进程退出，成功后取消旧轮次的当前身份并保留其证据，阻止迟到交卷覆盖修复。修复完成若 auto-review 开启则捕获新交付重新审查；未开启则正常 done，可再手动 review start。本版不自动重试，也不提供系统开机自启动服务。

已有 graph watch 订阅接收 pass/reject、blocked、未交卷退出和超时通知，无订阅时状态与日志仍可查询。先交卷后异常退出只补记运行异常，不重复发送结果通知。pending_review 和 reviewing 都不发送完成通知，正常一轮只在交卷后发送一次结论。通知带轮次和本轮报告入口；旧轮次未发送的消息在投递前取消。reject 附直接受影响后继，由主控安排修复；不会自动回滚已有工作。

运行记录在 `.task-graph/review.json`，提示词、交付副本和运行日志在 `.task-graph/reviews/`；这些含本机目录的运行数据自动忽略 Git。验收报告快照仍由任务记录引用。迁移项目时保留运行数据并处理原项目目录绑定，不能假定活动审查可随 Git checkout 自动迁移。
