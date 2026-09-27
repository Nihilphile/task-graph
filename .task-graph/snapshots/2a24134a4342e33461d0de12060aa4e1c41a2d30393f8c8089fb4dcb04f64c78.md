# Desktop Watch 实机记录

## 本轮环境与边界

- 日期：2026-09-27。
- Windows Codex Desktop 自带程序：`codex-cli 0.158.0-alpha.2.1`。
- 测试目标仅当前主控会话：`01a0d067-d9fc-7cd1-b278-4b068b7a7169`，环境 CODEX_THREAD_ID 与 CODEX_SESSION_ID 一致。
- 隔离项目：工具仓库 `output/desktop-watch-smoke`；无 GitHub，无其他用户任务。
- 通过真实 graph watch 和 task complete 调用自动后台 worker，未直接修改 queue 或 Desktop 数据库。

## 已观察

1. 18:05:24 注册 G-001，成功绑定当前 Desktop 程序与配置。
2. 18:05:45 完成 probe T-0001，报告为 probe.md；这只是测试事件，不表示本功能已验收。
3. watch --status 返回 accepted=1，pending/in_flight/uncertain/paused 均 0，attempts=1。
4. 事件：`1811baf714ba657ac75a40091d408a03fa42b7f922d0d3398301c4720ecaee0e`。
5. 严格 queue 回执：`01a0e253-edac-7191-a2c5-e35b2c95ca50`，目标 UUID 匹配。

## 后续轮实际消费

前一轮结束后，当前主控对话的新一轮输入实际出现 Task Graph notification，携带上面同一事件 ID。主控开始处理后读取的本机时钟为 `2026-09-27T18:16:14.2332303+08:00`；这是观察记录时间，不冒充 Desktop 精确入队/送达时间。

通知中的 project 指向本隔离项目，graph=G-001、task=T-0001、result=pass，报告 read_path 为 `.task-graph/snapshots/109a1b51a467ea08fd13ae68a2c2a4aa6dd1567623bbc97cb1b28c13330b70f3.md`。主控随后通过公开 CLI 查询该任务，确认 done/pass，并实际读取对应报告快照；与原测试事件相符。

本次因此观察到：当前 Desktop 0.158.0-alpha.2.1 下，已加载且忙碌的根会话在结束当前 turn 后，能够于后续 turn 消费该通知并继续既有工作。测试订阅已取消，没有为通过验收再次投递。待观察时保存的旧报告快照保留，供审计。

这里记录的是主控实际收到消息的观察证据；watch 的 consumption 字段仍为 unconfirmed，因为产品没有模型消费 ACK 协议，不手工伪造工具 ACK。

## 历史证据与未测边界

subagent-cli 记录的 0.153.4 已加载根会话 idle/busy 后续轮投递是历史证据。当前版本本轮只观察上述有界测试，不继承为全面兼容承诺。未测 App 退出、会话未加载、跨机器、切页、中断恢复；不保证当前轮 steer、消费 ACK 或 exactly-once 消费。
