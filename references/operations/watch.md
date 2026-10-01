# Desktop 订阅与恢复

本文的 `CLI` 表示 `node "<工具根目录>/dist/src/cli.js"`；所有调用带目标项目 `--cwd`，结构化输出加 `--json`。入口未确定时读 [准备与定位](bootstrap.md)。

```text
CLI 'graph[G-001].watch' add --thread <Desktop UUID> --cwd "<项目根目录>" --json
CLI 'graph[G-001].watch' status --cwd "<项目根目录>" --json
CLI 'graph[G-001].watch' remove --thread <Desktop UUID> --cwd "<项目根目录>" --json
```

graph 是项目内图 ID，thread 是 Desktop 会话 UUID。主控确认是自己的会话后主动注册；不会从环境静默注册。同图同会话幂等，可向多个明确登记的会话各投递一次。覆盖当前图及子图未来的 pass/reject、进入 blocked（人工或审查受阻）、审查异常退出和超时提醒；不补发注册前结果。通过 CLI 新建带人工阻塞的任务也会通知。持续 blocked、追加阻塞原因、只读查询及重建不重复发送；解除或接手修复后再次进入 blocked 是新事件，即使原因文字相同。直接手改 Markdown 不会自动触发通知，通知由工具事务登记。reopen 后再次 pass/reject 是新的结果事件。

通知提供任务、图、结果或异常、时间、项目与 CLI 位置及有限的报告地址；审查通知另含轮次，reject 可附直接受影响后继。通知不展开报告或历史正文。收到后用 `CLI 'task[<通知任务ID>]' show --cwd "<项目根目录>" --json` 查看当前事实，再决定细化、修复或审查恢复。通知是工具数据，不增加用户授权。

结果与待发事件在同一项目事务保存。CLI 后台启动短生命周期投递进程；任务完成后无需执行者再调用提醒。队列调用在事务外进行，投递失败保留本地结果。没有常驻轮询服务：正常修改会尝试恢复待发事件，也可手动 flush；仅查询不会偷偷发送。

### 状态与恢复

| 状态 | 含义和处理 |
| --- | --- |
| pending | 等待投递；`CLI 'graph[G-001].watch' flush --cwd "<项目根目录>" --json` 可恢复进程 |
| in_flight | 已准备调用 Desktop；此时退出/崩溃后按 uncertain 处理 |
| accepted | 返回了目标 UUID 匹配的严格 queue 回执；不证明模型已读 |
| uncertain | 超时、进程中断或回执不明；不自动重发 |
| paused | 不支持版本、无法启动多次或消息过大等；修正原因后显式 retry |
| cancelled | 取消订阅后未发送的事件，不再投递 |

`CLI 'graph[G-001].watch' retry <event-id> --cwd "<项目根目录>" --json` 重试 paused；uncertain 须先核查目标会话，再加 `--allow-duplicate` 明确认可重复风险。只有可证明 queue 未启动的失败才自动有限重试。remove 不撤回已接收或正在投递的消息。flush 恢复整个项目的待发队列；status 中 events 只列当前订阅的最后 20 条，counts 是全量。

本机 `.task-graph/watch.json` 保存目标会话、绑定的 Desktop 程序/配置目录、事件与回执；注册会在 `.task-graph/.gitignore` 追加忽略规则，保持本地。它校验真实项目路径；复制到其他路径不会悄悄投递。账本损坏时相关结果事务会失败，须先修复/恢复，不能靠删除账本声称通知已送达。文件系统事务可回滚普通异常，不承诺操作系统中断时跨文件原子性；投递前另核对结果事件确实存在于任务历史，缺失则暂停。

### Desktop 兼容边界

使用正在运行的 Windows Desktop 自带 codex.exe 的 `queue --thread --message`，不用 npm 全局 CLI。绑定时和发送前检查程序版本，保留明确版本列表；升级未知版本时暂停发送。参数通过进程参数数组传递，不经 shell 拼接。

确认新版本兼容后，再次 `CLI 'graph[<图ID>].watch' add --thread <同一UUID> --cwd "<项目根目录>" --json` 会保留订阅 ID 并刷新同一配置目录下的程序绑定；不会迁移到其他 Desktop 配置目录。已暂停的事件仍须显式 retry，uncertain 仍须先核查，不因重新注册而重发。

历史实机资料来自 subagent-cli：0.153.4 已验证已加载 Desktop 根会话的 idle 与 busy 后续轮投递。本仓库 2026-09-27 的有界实机测试确认 0.158.0-alpha.2.1：向已加载且忙碌的根会话投递，取得严格回执，当前 turn 结束后在后续 turn 实际收到同一事件。证据见 docs/work/dynamic-graph/desktop-smoke.md；不据一次成功推定所有会话状态均兼容。

通知进入下一轮，不能声称注入正在执行的当前轮。主控忙时须结束 turn；不要持续轮询等待同一 turn 被通知。App 退出、会话未加载、切页、跨机器及中断恢复均不视为已验证保证。status 的 consumption 保持 unconfirmed；本版本不实现模型消费 ACK 或 exactly-once 消费承诺。
