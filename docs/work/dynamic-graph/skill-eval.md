# 动态技能独立行为验证

评估时间：2026-09-27 18:01—18:09（Asia/Shanghai）。评估者为独立委派执行者；首次仅获技能路径、CLI 入口、隔离限制与现实流程场景，没有获得预期命令答案或已知缺陷。先阅读技能，再根据其链接及 CLI help 自行发现操作。

## 结论

修复本轮发现的批量计划字段遗漏后，能够凭 `to-active-task`、`task-take` 及其指向的根 SKILL/help 完整走通：动态骨架 → 只细化 A → A 完成并提供 reference → 发现 B 缺调查 → 新增 C 前置 → 增量 content/refine → B 执行 → V 独立 reject → 新增修复 F → 重新 refine/reopen → V pass → 父任务显式收口。最后六项任务全部 done/pass，validate 返回 ok=true、issues=[]。

技能主控/执行者职责可区分；与静态 to-task 没有实质冲突。一次真实可复现 CLI 缺陷已反馈并在评估期间修复；另有两项可改善的恢复/文档细节见下文。Desktop 模型消费未验证，不能据此报告本功能全项验收通过。

## 版本和证据位置

技能初读时修改时间均为 2026-09-27 09:56:52 UTC，结束时 SHA256 未变：

- skills/to-active-task/SKILL.md：A5415EFFFBFA216EC7E4FFCDA7FDD42CE0C46B0E801D3C09B329821B3C396DA7
- skills/task-take/SKILL.md：2C09831D8E6D3805974E2770E41DF6C7FD7532CDCF1DA7BC7B4D149C30EACF98
- skills/to-task/SKILL.md：A5DF708A4EDDAE5483438193E336287D1D23E61E17C2B9A3E16718F238EBD795

入口：`node D:/文档/ChatGPT/画板/task-graph/dist/src/cli.js`，每次显式带 --cwd 临时项目与 --json。代码正在并行修订，初读 dist cli.js 时间为 10:00:19 UTC；18:07 最后观察为 10:06:19.426 UTC，因此这是本轮变化期间的行为验证，不是固定 commit 的发布认证。

临时目录：`C:/Users/Dreamjiao/AppData/Local/Temp/task-graph-skill-eval-e39dd206804242328378f43ff39340d8`。首轮错误保留于 transcript.jsonl；完整成功流程位于其 `retest/`，其中包含原始 plan.json、created.json、逐命令 transcript.jsonl、实际小型实现、原生 Node 验证脚本、报告、任务状态及 HTML。复验 HTML 为 `retest/.task-graph/generated/index.html`。仅本报告写入仓库，未修改实际项目任务状态、未注册 watch、未调用 GitHub。

## 实操场景及结果

演练功能：normalize 去掉字符串首尾空白；greet 保持大小写并返回 Hello, Alice!。A/B/V 的验收条件在实现前确定。独立验收前在隔离 fixture 主动注入大写回归，以真实断言触发 reject；修复后使用同一原始断言，不改验收标准。此人工故障注入只用于测试工作流。

| 阶段 | 操作与直接观察 |
| --- | --- |
| 骨架 | 批量创建 P=T-0001，A=T-0002，B=T-0003，V=T-0004；P 属 G-001，子任务属自动创建 G-002，全部 planning=dynamic，V kind=acceptance，V 绑定两份 content。 |
| 只细化 A | A 未 refine 的 start 返回 E_TASK_BLOCKED。主控 refine 后执行者 start、读 context.contents、写接手日志，直接实施，无二次许可。 |
| 前置交付 | A 的 reference 在 complete 前登记。B show 自动得到 A reference 和 report 索引；B 仍 awaiting_review，直接 start 被拒绝。 |
| 缺口转前置 | 新建 C=T-0005，task link B --depends-on C；C 未完成时 refine B 被 E_TASK_BLOCKED 拒绝。 |
| 调查交付 | C 读取演练现有配置 src/compat.json，登记带出处的 reference 后 complete。未把待决定产品方向冒充用户已批准决定。 |
| 增量要求 | 为 B attach docs/b-implementation.md，refine 后再追加验证入口，B 变为 stale，start 被拒绝；再次评估/refine 才可开始。 |
| 空白执行上下文 | B 的 start context 同时返回两份 content 与 A/C 两份 reference；实际逐份读取后记录接手与实施。 |
| 独立 reject | V 实际运行三项断言：trim PASS、empty PASS、greet REJECT（实际 ALICE，期望 Alice）。task reject 保存失败报告并清除 claim，状态为 reject。 |
| 修复依赖 | 主控新增 F=T-0006，把 V 依赖接到 F；F 未完成时 V reopen 因 unmet dependency 和 stale 被拒绝。 |
| 显式复验 | F 修复、登记 reference 并 complete 后，主控 refine V，reopen 后执行者 claim；再次独立运行原三项断言全部 PASS。complete --result pass 提交新的报告。 |
| 保留证据 | V show 仍同时列出 reports/v-reject.md 和 reports/v-pass.md 的不同 snapshot read_path，旧失败证据未被覆盖。 |
| 收口 | P refine/start/log 后 complete 成功；所有子任务 done/pass；validate 无问题。 |

上述命令的退出码与 JSON ok 已记录在 transcript.jsonl。Node 原生断言的输出也写入对应报告；报告含代码 SHA256 和明确未覆盖范围。

## 发现与改进建议

### 已修复：批量导入拒绝技能示例中的 planning

首轮 `task add --from plan.json --graph G-001` 返回 `E_PLAN: Unknown tasks[0] field "planning"`，没有创建任务。当时 help 已列出动态规划参数，故不能按技能示例落地。反馈后主控修复批量字段白名单；在全新隔离 retest 目录用同一份 plan 成功导入动态父子任务、acceptance 类型和多 content。此项修复已经行为复验。

### 小文档缺口：从未开始的统筹父任务无法直接 complete

to-active-task 末尾说子任务满足后“显式 complete 父任务”，而允许初始只细化 A 的流程没有要求主控何时开始 P。实操中 P 保持 todo，直接 complete 返回 E_TASK_TRANSITION（todo 不能直接 done）。根据根 SKILL 与 task-take 补做 P 的 refine/start/log 后即可收口。建议在收口句增加“尚未开始的统筹父任务先由主控 refine/start”，无需新增许可步骤。此项没有阻断熟悉可发现文档的代理，但空白主控容易多一次错误。

注意：那次负例先被 todo→done 状态门槛拒绝，因此它本身不构成“reject 专门阻止父任务完成”的直接实测证据；应引用专门回归补足，不能夸大该负例。

### 恢复提示：单条创建与批量重试并非总能互换

首轮批量失败后曾尝试单条创建 eval.parent 成功；随后同标题、content、graph、planning 的原计划批量重试返回 E_KEY_CONFLICT。为不混淆主流程，保留该目录并在全新临时目录完成正向验证。尚未定位该差异的规范化原因，不直接判定产品缺陷；建议主控决定是否要求不同入口的同参 key 幂等。技能要求保持同一 key、参数与路径重试是清楚的，但不宜把改换单条/批量方式当成无条件安全恢复。

### 门槛与角色边界

已直接验证 skeleton/awaiting_review、未满足新依赖、content 改动导致 stale、修复未完成时 reopen 的阻断。执行者指南明确不得自行 refine，与主控 refine 流程一致。CLI 本身没有身份认证去证明 --actor 真是主控，且 refine 只能记录判断与指纹、不能证明语义充分；技能已经明确后者，不能把该工具当成强身份权限系统。

reject 后尚未改变依赖时，show 的 planningState 仍为 refined；本次按文档新增 F 后变 stale，再 refine/reopen。未独立测试“reject 后不改任何输入便立即 reopen”是否强制生成新 refinement，不对此作未测试的保证。

## 技能职责与静态工作流

- to-active-task description/body 明确“主控动态规划”，保留目标/约束/早期验收标准，只细化前沿；遇调查、能力缺口、需人类决定分别处理，不替人作决定。
- task-take 明确执行者读取全部 content、必要 references、写接手日志后施工；缺口 block，交付 reference 后 complete；独立验收者报告结果，把修复交主控，没有要求执行者重做规划或寻求二次许可。
- to-task 正文明确默认 static，动态模式改用 to-active-task，两者不是前后步骤。其 description 可增加“一次性详细规划”以在尚未加载正文时更准确分流，但正文没有语义冲突。
- task-take 对普通任务与 acceptance 的完成责任说明一致，旧任务约定主控验收时保留当前状态，不擅自改约定。
- to-active-task 的新增依赖/reopen 命令语法未内联全部示例，但根 SKILL 命令索引和 help 可发现；本次自主发现 task link、task reopen，无需预给命令答案。

## acceptance.md 的额外只读评估

本节为读取 tests/graph-watch.test.ts、src/core/watch.ts、src/core/desktop-notify.ts 以及主控已有测试日志后的评估，没有新增实际通知。

fixture 测试包含显式注册/重复幂等/子图结果/无历史回补/unwatch 取消；状态查询不变更账本；通知只带报告地址不含正文；uncertain 不自动重发且需要 --allow-duplicate；失去 owner 的 in_flight 变 uncertain；活 owner 阻止并发；可证明未启动最多四次尝试；中文、多行、引号和美元符号按参数数组原样传递；严格目标回执；版本拒绝、启动失败、超时和过量输出。源码对应：shell=false、windowsHide=true；任务结果与 outbox 同事务；队列调用在事务外；目标项目 canonical path 校验；accepted 与 consumption=unconfirmed 分开。

这些是代码/fixture 覆盖评估，不替代当前桌面实机消费证明。主控 docs/work/dynamic-graph/desktop-smoke.md 记录当前版本 0.158.0-alpha.2.1 的 accepted、attempts=1 和严格 receipt；该文档也明确主控 turn 尚未结束，实际消费仍待观察。不能把历史 0.153.4 或 accepted 推导为当前消费已通过。18:08 读取 output/dynamic-final-tests.log 时全套仍在执行，不能据半程日志宣称最终全绿；完整结果由主控收口后登记。

本次未直接操作 HTML UI、未重跑全套回归、未实测 watch 外发与模型消费、未检查强身份授权，也未验证所有生命周期组合。以上边界保留在最终验收判断中。
