# CLI 接入与交接

仅在收到 task-graph 任务 ID 时读取。本文提供操作协议，执行流程由 `matt-task-take` 定义。

## 入口和项目位置

优先使用派工给出的 CLI 绝对入口和任务图项目根目录。入口未知时，查找已安装 `task-graph` 的真实目录，解析 junction/symlink；CLI 工具根应含 `package.json` 和 `dist/src/cli.js`，完整技能包另含 `SKILL.md`。本技能是独立目录，不能从本技能的父目录推断工具位置。

下文 `CLI` 代表 `node "<工具根>/dist/src/cli.js"`。每次带 `--cwd "<任务图项目根>" --json`；资源地址加引号。正文和附件路径相对任务图项目根，代码入口可使用另一 checkout 的绝对路径。独立 worktree 时沿派工指定的权威图位置操作，不自行初始化第二份图。

动作参数通过 `CLI '<资源地址>' describe` 或命令的 `--help` 确认。检查退出码和 JSON `ok`；失败读取 `error`。写入已保存但视图刷新失败时单独修复构建，状态回执不确定时先 show，避免重复交卷。本文不要求整套读取 task-graph 的角色工作流。

## 读取与领取

```text
CLI 'task[<ID>]' show --cwd "<图项目>" --json
```

show 默认返回材料索引而非全文。读取索引中全部 content、适用 contract 和 RR；报告、日志、handoff 和代码导航按接续需要读取。可用 `--expand content --expand contract --expand review-requirement` 展开必读正文；以当前 context 提供的路径和用途为准。文件 `read_path` 相对 `context.project_root`；mode=snapshot 时读取该快照，不能改读来源文件的新版本。

- todo 且 ready：使用实际执行 role/session-id 原子领取并开始。
- 已由主控 start 且 claim 属于当前会话：复用回执或 show 接续。
- in_progress 且未领取：用 claim 登记实际身份。
- 属于其他会话、依赖未满足、动态任务尚未 refine 或已结束：交由主控安排，不自行接管或绕过门槛。
- 被派工修复 blocked：start/claim 成功后进入 in_progress，读取 repair.previous_blockers 和旧报告；归档阻塞原因不证明问题已修好。
- reject/done 的修复需主控明确 reopen；pending_review/reviewing 不属于实现者可继续修改的阶段。

```text
CLI 'task[<ID>]' start --role "<执行角色>" --session-id "<真实会话ID>" --cwd "<图项目>" --json
CLI 'task[<ID>]' claim --role "<执行角色>" --session-id "<真实会话ID>" --cwd "<图项目>" --json
```

两条按状态选用，不连续例行执行。使用运行环境或派工提供的真实身份；未知时先查询当前会话身份，不编造 ID，也不冒用主控身份。

无法继续时用 `block --reason "<缺口与解除条件>"` 保存实际阻塞。依赖等待由 readiness 表达，无需再登记同义人工阻塞。解除或重新接手按实际状态执行；审查恢复由主控处理。

## 报告与代码入口

使用派工指定的报告位置；未指定时选项目内现有文档布局，报告写结果、验证、版本和限制即可。为报告选择新的本轮路径，或确认旧报告快照已经保存后更新。

后继需要定位关键实现时：

```text
CLI 'task[<ID>].reference' add --path "<代码路径>" --line <正整数> --symbol "<符号名>" --summary "<用途>" --cwd "<图项目>" --json
```

summary 最多 30 个 Unicode 字符。行号以交付时实际位置为准，符号名帮助应对文件移动。相同路径和符号复用既有 ID；已绑定入口变化时更新共享条目：

```text
CLI 'reference[<入口ID>]' update --path "<代码路径>" --line <正整数> --symbol "<符号名>" --summary "<用途>" --cwd "<图项目>" --json
```

更新 contract 时操作原 ID 和权威正文，不另复制一份到报告。查命令的 --help；使用完整技能包时可读工具根 `references/operations/contracts.md` 的参数细节。规划与决策操作按本次派工范围执行。父级与相邻任务正文不自动继承，必要约束应已经绑定到本任务。

## 完成与中途移交

```text
CLI 'task[<ID>]' complete --report "<项目相对报告路径>" --cwd "<图项目>" --json
```

只有运行中的任务可以 complete。复合任务还受 completion_requires 约束；父任务不会因子任务完成而自动 done。complete 自身不执行 Git。

done 表示本地任务已完成；pending_review/reviewing 表示交付已提交、独立审查未结束。保存回执后结束本轮实现，不手改状态或直接关闭外部 issue。独立审查的结论和 review-id 由 reviewer 交卷，本技能只提供实现与证据。

若 task.kind=acceptance，本任务是独立验收而非实现：按工具根 `references/operations/acceptance.md` 的交卷协议提交明确 pass/reject、报告和必要失败复盘，不同时修复被验实现。持有 review-id 的情况使用独立 reviewer 入口。

中途换人时，先保存已做、未做、证据入口和下一步，再绑定：

```text
CLI 'task[<ID>].handoff' attach --path "<项目相对交接路径>" --cwd "<图项目>" --json
```

`.handoff create` 仅冻结材料索引，不能代替进展总结。绑定 handoff 不释放 claim；确定移交时按主控安排执行 release/reassign，不能让新执行者误以为任务无人占用。暂时受阻可以保留 claim，由原执行者恢复。

结构化状态、领取和关系均由 CLI 修改。工具已有的 report 快照、reference 和 contract 足以交接，不额外建立第二套状态文件、ticket 正文或例行日志。
