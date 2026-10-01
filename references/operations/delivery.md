# 执行者：登记交付与中途交接

本文 `CLI` 为 `node "<工具根>/dist/src/cli.js"`，命令带项目 `--cwd`，自动化加 `--json`；入口缺失见[准备与定位](bootstrap.md)。

## 交付

Git 项目中，验证后只暂存本任务修改（可按代码块），串行提交；提交说明仅为 `任务ID路径@代数`：顶层任务如 `T-0042@1`，子图任务如 `T-0042/S-0043@1`，嵌套子图按父子顺序列全直到本任务。代数按本任务每次新交付递增，重试 complete 不递增。报告关联 commit SHA，具体变化与验证留在报告。无文件变更不做空提交；complete 本身不执行 Git。

报告写最终变化、验证证据和剩余问题，区分实际观察、引用结论与未验证项。改变共享契约时更新原 contract；后继需要定位的代码按[条目规则](contracts.md)登记 reference。报告引用契约和入口，不复制完整接口说明；无必要入口则省略 reference。

```text
CLI 'task[<任务ID>].reference' add --path <代码路径> --line <行号> --symbol <符号名> --summary "<最多30字用途>" --cwd "<项目>" --json
CLI 'task[<任务ID>]' complete --report <报告路径> --cwd "<项目>" --json
```

reference 通过依赖提供代码导航，contract 提供当前契约，report / handoff 保留交付和接续证据。实现与约定冲突时遵循 [task-take](../../skills/task-take/SKILL.md)。

满足任务完成条件后自行 complete，无须主控先读报告；这不等于用户最终验收。返回 pending_review / reviewing 后结束本轮执行，不重复领取或提交，修复按新派工接手。kind=acceptance 使用[验收任务](acceptance.md)的 pass/reject 操作。

## 中途交接

在日志或 handoff 文件中写明已做、未做、证据入口和下一步，引用已有材料。自动 `.handoff create` 只冻结要求与附件索引，不生成进展总结；手写文件用 `.handoff attach` 登记。尚未完成的任务不 complete。
