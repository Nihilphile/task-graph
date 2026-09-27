# 动态任务、独立验收与 Desktop Watch

下文 `CLI` 代表 `node "<工具目录>/dist/src/cli.js"`；所有调用带真实项目 `--cwd`，自动化加 `--json`。用 `task[T-0001]` 定位已知任务，或用 `graph[G-001].task[T-0001]` 校验图归属；子图任务可沿 `.subgraph.task[T-0002]` 寻址。各地址的操作和参数通过 `CLI '<地址>' describe` 查询，详见 [资源地址 CLI](resource-cli.md)。计划方式由主控选择：to-task 详细规划，to-active-task 骨架加逐步细化；已有任务默认 static。

## 多文件 Content

- `CLI 'graph[G-001].task' add --content goal.md --content constraints.md --cwd "<项目根目录>" --json`；批量计划 `content` 接受字符串或路径数组。
- `CLI 'task[T-0001].content' attach --path details.md --summary "具体接口和验收入口" --cwd "<项目根目录>" --json` 增量绑定 live 要求。
- `CLI 'task[T-0001].content' remove --path goal.md --cwd "<项目根目录>" --json` 解除绑定，保留文件、历史和过去的 start 快照；不能移除最后一份要求。
- `context.contents` 给出全部当前要求；兼容字段 `context.content` 指向第一份。HTML 多文件先显示列表。show 默认索引，正文仍须显式 expand。
- 全部文件共同生效，不按附件顺序覆盖。主控负责消除冲突。Content 仅面向 agent；依赖不会自动继承其他任务的 Content。

数据保持兼容：原 content 字段为首个入口，增量文件保存在 outputs 的 content 类别。开始任务时保存全部要求的快照；直接编辑原文件不会改动旧快照。

## 骨架与放行

创建时 `--planning dynamic`；批量 JSON 使用 `planning: "dynamic"`。子任务逐个显式指定，不继承父任务模式。

| planningState | 含义 |
| --- | --- |
| static | 原静态任务流程 |
| skeleton | 动态骨架，尚有依赖或人工阻塞 |
| awaiting_review | 其他阻塞已解除，等待主控判断 |
| refined | 主控已评估当前输入，可以按 readiness 判断派工 |
| stale | 本次评估的输入已变化或不可读，须重新判断 |

`CLI task list --needs-refinement --cwd "<项目根目录>" --json` 返回 todo/reject、未领取且只剩细化门槛的任务。`CLI 'task[T-0001]' refine --reason "评估依据" [--actor "主控"] --cwd "<项目根目录>" --json` 在依赖/人工阻塞消除后保存放行；同一地址的 `unrefine --reason "原因"` 撤销未执行任务的放行。允许未领取的 todo/reject，以及明确准备返工的 done；禁止对执行中任务操作。

输入指纹包括全部当前要求字节、标题/类型/依赖、直接前置的 agent reference 与相关状态/完成历史。live 参考按当前字节，snapshot 按冻结版本；自身交付 reference、日志、报告和领取不使评估失效。指纹只能检测变化，不能替代主控对能力、接口和信息是否充分的判断。

start/claim/reassign 拒绝未放行的动态任务。执行中不允许通过 CLI 静默改变要求绑定、依赖、标题和要求正文；先协调施工，必要时取消/替代并重新建立关系。替代任务保留 planning 和 kind，须重新 refine；后继关系仍须由主控审阅调整。外部直接编辑文件无法被锁住，工具可检测变化，执行者发现不一致时记录缺口并反馈主控。

## 验收结果

`kind` 可为 work（默认）、acceptance 或 decision。独立验收使用 acceptance，并依赖必要实现；父任务完成目标必须包含验收任务。

```text
CLI 'task[T-0001]' complete --result pass --report reports/pass.md --cwd "<项目根目录>" --json
CLI 'task[T-0001]' reject --report reports/reject.md --error-report reports/error.md --cwd "<项目根目录>" --json
CLI 'task[T-0001]' complete --result reject --report reports/reject.md --error-report reports/error.md --cwd "<项目根目录>" --json
```

reject 还必须提供非空 Markdown 小报告 --error-report，写法见 [error-book](error-book.md)。

以上写法按实际结果选一条（reject 两种等价写法）。验收任务必须提供明确结果和本轮报告。pass 对应 status=done；reject 是独立状态，均释放 claim、保存报告快照与历史。旧普通任务 complete 可不传 result，保持兼容。

reject 不满足完整依赖、局部 gate 或父任务完成目标。修复后显式 reopen（或 start --reopen）；动态任务先重新评估，必要时增加修复依赖再 refine。失败证据保留，复验报告单独保存版本。环境无法运行时 block 并记录缺口，不伪造验收结果。

已经 done 的动态任务若需返工，同样检查当前输入；已 stale 时允许主控对未领取的 done 任务重新 refine，然后显式 reopen。refine 本身不改变验收结果，不会把已完成任务悄悄改回施工中。

## 显式订阅

```text
CLI 'graph[G-001].watch' add --thread <Desktop UUID> --cwd "<项目根目录>" --json
CLI 'graph[G-001].watch' status --cwd "<项目根目录>" --json
CLI 'graph[G-001].watch' remove --thread <Desktop UUID> --cwd "<项目根目录>" --json
```

graph 是项目内图 ID，thread 是 Desktop 会话 UUID。主控确认是自己的会话后主动注册；不会从环境静默注册。同图同会话幂等，可向多个明确登记的会话各投递一次。覆盖当前图及子图未来的 pass/reject，以及独立审查的 blocked、异常退出和超时提醒；不补发注册前结果。reopen 后再次 pass/reject 是新的结果事件。

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


## 独立审查

审查任务的 `pending_review` 不放行完整依赖；pass/reject/blocked 与 failed 的恢复规则由 [独立审查](review.md) 统一说明。动态任务仍由主控根据审查结果判断是否重新 refine、修复或另建任务。
