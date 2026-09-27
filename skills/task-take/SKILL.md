---
name: task-take
description: >-
  接手已分配的 task-graph 任务：读取要求和参考、记录上下文确认后自主执行，
  记录缺口、验证并登记报告与后继参考。适用于子代理收到 task ID，
  或任务的 start/show 返回本 Skill 入口时；任务拆分与细化由主控负责。
---

# Task Take

你已获派工授权。接手记录用于追踪上下文是否充分：确认具备开工条件并写入工作记录后立即施工，无须等待主控二次许可。执行范围、验收责任和交付约定以当前任务为准。

## 1. 获取当前任务

派工应提供实际项目/checkout 路径、task-graph CLI 路径和任务地址。本文的 CLI 是 `node "<实际CLI路径>"` 的缩写；每条命令带 `--cwd "<实际项目路径>"`，自动化调用加 `--json`。缺少入口时先向派工方取得位置。仅收到 task ID 时，直接用 `task[<任务ID>]` 查询；返回的 `task.resource` 给出可复用的完整图地址。参数和条件可通过 `<任务地址> describe` 查询，地址规则见 [资源地址 CLI](../../references/resource-cli.md)。

若刚收到任务的 start 成功响应，直接使用其中 context。若已由主控开始、恢复执行或需要刷新，用：

```text
CLI 'graph[<图ID>].task[<任务ID>]' show --cwd "<实际项目路径>" --json
```

检查 status、claim 和 blockedBy。待开始且就绪的任务，用实际 role/session-id 执行 `'task[<任务ID>]' start`；已由当前会话开始的任务直接继续。领取属于其他会话、任务已结束或存在未解除的开工阻塞时，记录/反馈具体冲突，由主控明确接续安排。start 表示接下任务，接下来完成阅读与接手记录。

主控代为 start 时应登记你的实际会话 ID；查询确认领取属于自己后继续。若尚未领取但任务已开始，使用 `'task[<任务ID>]' claim --role <实际角色> --session-id <实际会话ID>` 记录责任人，然后继续。

动态任务须由主控 refine 后才可开始；依赖完成不等于已经放行。发现 skeleton、awaiting_review 或 stale 时反馈主控，不自行 refine 绕过门槛。reject 任务只按明确复验安排显式 reopen。含 subgraph 的父任务先确认自己承担统筹还是具体施工，避免重复执行子任务范围。

## 2. 阅读后记录，再直接开工

- 完整读取 context.contents 中的全部要求文件；旧版只有 context.content 时读取该入口。多个文件共同构成当前要求。清单中的 read_path 均相对 context.project_root；固定版本读取快照路径。
- 读取 context.review_requirements 中的全部验收要求，与 content 的明确约束共同作为交付依据。
- 浏览 context.references 的 summary 和 source_task，读取任务必需的资料与相关接口/章节。检查 error；summary 是索引，必要内容仍须实际读取。
- 接续已有工作时，从 context.logs/reports/handoffs 的摘要定位所需文件。show 和 --handoff 默认只给索引；需要 CLI 返回正文时，用 `--expand-path <路径>` 选择文件，或 `--expand content|report|log|reference|handoff|output` 选择类别。可先加 --preview 查看体量。优先精确选择所需文件，读取当前任务要求后再决定其他资料。
- context.excluded 中列出用途或路径排除项。audience=user 的附件仅供人阅读；旧自动 handoff 标记 legacy_aggregate 时可能包含混入的正文，使用当前索引恢复上下文。按项目交接要求排除的路径，用 --exclude-path 显式传入；不要因为旧快照引用了它而绕过排除。

能够明确工作范围、必要接口/输入以及验证方法后，使用任务地址的 `.log add` 写一条简短接手记录，点出关键依据与结论。例如：

```text
CLI 'graph[<图ID>].task[<任务ID>].log' add --text "接手检查：已读任务要求、报告接口及前置接入说明；已明确修改范围、错误语义与测试入口，具备开工条件，开始实施。" --cwd "<实际项目路径>" --json
```

记录后立即执行。正常代码探索在施工中完成，不必提前消除所有未知；记录按实际阅读情况填写。

## 3. 开工前和施工中处理上下文缺口

发现缺口就通过 `.log add` 记录：缺少什么、影响什么、需要什么信息及由谁补充。可继续推进时，先做不依赖该信息的部分。

确实无法继续时，同时执行 `'task[<任务ID>]' block --reason "<缺口与解除条件>"`，让主控能从任务列表发现阻塞；必要时使用所在调度环境的求助机制。日志与 block 本身不会主动唤醒主控。

信息补齐后，记录结论及依据，用 `'task[<任务ID>]' unblock --reason "<原阻塞原因>"` 解除对应项；在已有授权内继续，无需再申请开工许可。需要扩大范围的决定交由主控处理，其余已授权工作继续。

## 4. 验证、登记 reference、完成

按任务完成条件验证，报告写明结果、证据及剩余问题。完工前检查后继需要消费什么，并在 complete 前登记必要 reference，保证后继变为就绪时能取得资料：

- 优先绑定已有接口定义、代码入口或维护中的文档；summary 说明所需符号/章节及用途。
- 现有文件不足以说明接入方法时，补写短参考文档，包含实际代码位置、调用/错误约定、关键限制及验证入口，按本任务实际需要取舍。
- 任务明确约定的 reference 必须交付。其他任务按后继需要提供；无可复用交付时不必额外造文件。

reference 应准确反映实际实现。若实际行为与任务或已确认接口约定冲突，记录偏差及对后继的影响，交由主控协调修订；参考文档本身不构成变更任务约定的授权。

```text
CLI 'graph[<图ID>].task[<任务ID>].reference' attach --path <项目相对文件路径> --summary "<接口或章节，以及后继如何使用>" --cwd "<实际项目路径>" --json
CLI 'graph[<图ID>].task[<任务ID>]' complete --report <项目相对报告路径> --log "<完成结论、验证结果与剩余问题>" --cwd "<实际项目路径>" --json
```

reference 默认跟随当前文件；需要保留固定交付版本时加 --snapshot。后继通过依赖自动取得登记，无需再次绑定。report 保存交付证据；handoff 用于同任务尚未完成时的接续，两者不能替代约定的 reference。

供用户阅读、与任务施工无关的工具反馈等附件，attach 时加 --audience user，避免混入后继上下文。保存的自动 handoff 只冻结本任务要求及附件索引；需交接进展时将关键结论写入工作记录或独立 handoff 文件。

若 `task.review.enabled=true`，complete 返回 `pending_review` 表示已交付，工具已安排独立审查；到此结束本轮执行工作，审查结果以审查者的 `.review finish` 为准。主控已订阅 graph watch 时会收到结果或异常通知，否则可查询任务及 `.review status`。`pending_review` 不要求执行者再次领取或 complete；后续修复按主控的新安排接手。

未启用 auto-review 时，按任务约定的验收责任完成：普通实现任务完成自己的验证后 complete，后续独立验收由对应任务执行，父任务由主控读报告后收口；旧任务明确要求主控验收的，先用 `<任务地址>.report attach` 并记录待验收事项，保留当前状态。中途交接则记录已做、未做、证据及下一步，并用 `<任务地址>.handoff create` 保存交接。

### 独立验收任务

当 task.kind=acceptance 时，依据事先确定的验收要求独立验证。报告逐条记录 pass/reject、原生证据、实际代码/构建版本和未覆盖项，区分亲自观察与引用前置报告。环境或资料缺失导致无法验证时记录缺口并 block，不据此伪造产品失败或通过。

```text
CLI 'graph[<图ID>].task[<验收ID>]' complete --result pass --report <报告路径> --cwd "<实际项目路径>" --json
CLI 'graph[<图ID>].task[<验收ID>]' reject --report <失败报告路径> --log "<失败条件与证据入口>" --cwd "<实际项目路径>" --json
```

二选一执行；验收任务必须明确结果并提交本轮报告。两者都保存证据并释放领取；reject 不满足后继依赖或父任务完成目标。独立验收中发现实现缺陷交由主控安排修复，避免自行扩大范围修复后直接宣布独立通过。复验保留先前报告并提交新证据。图已订阅 watch 时结果自动进入通知队列，执行者无需另发提醒。

检查 CLI 的退出码和 ok；GitHub pending 表示本地已保存、远程待同步，把这一事实记入交付记录。主控通过 task 查询工作记录与附件，无需额外编写重复的聊天回执。结束后交回调度环境，继续其他任务按派工安排。
