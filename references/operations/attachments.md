# 绑定要求与附件

本文 `CLI` 为 `node "<工具根>/dist/src/cli.js"`，下列命令均带项目 `--cwd`，自动化加 `--json`；入口缺失见[准备与定位](bootstrap.md)。

## 要求与 RR

- 创建时可重复 `--content <路径>`，批量 content 接受路径数组。
- 增补：`CLI 'task[T-0012].content' attach --path <路径> --summary "<用途>"`；解除：同一资源 `remove --path <路径>`，保留文件和历史快照，不能移除最后一份要求。
- 全部 content 共同生效，不按顺序覆盖，也不通过依赖继承；主控负责消除冲突。context.contents 列出全部要求，show 默认只给索引。
- RR 使用 `'task[T-0012].review-requirement' attach/remove`。绑定 RR 不自动启用审查；已启用时须保留有效 RR，审查期间绑定固定。见[审查控制](review-control.md)。

## 分类与版本

| 分类 | 保存方式 |
| --- | --- |
| content | 当前文件；start 保存要求快照 |
| review-requirement | 当前文件；审查启动时固定 |
| report | attach 时保存快照，可有多份和多版本 |
| log | 默认日志或附加的当前文件 |
| handoff | create / attach 时保存快照 |
| 旧 reference 文件 | 保留原 live/snapshot；新条目见[契约与代码入口](contracts.md) |
| output | 路径登记，可在文件创建前添加 |

```text
CLI 'task[T-0012].report' attach --path doc/reports/test.md --title "验证结果"
CLI 'task[T-0012].log' add --text "<记录正文>"
```

report/log/handoff 的 attach 可加 summary，未指定 title 时用文件名。summary 写所需章节、符号和用途。

report attach 不改变状态；complete 可重复 `--report` 提交尚未附加的报告。相同路径、相同内容不能重复附加；内容变化后可另存一版。已附加的报告无需在 complete 时重复提交。

log add 自动维护默认日志；已有独立日志可用 log attach，无须复制。记录边界遵循 [task-take](../../skills/task-take/SKILL.md)。

live 文件编辑后 build 刷新 HTML；改原文件不改变已有快照。旧 reference 文件仍可读取和移除，新的共享规则与代码入口使用[contract/reference 条目](contracts.md)。

## 交接

- `'task[T-0012]' show --handoff`：只读预览，不保存条目。
- `'task[T-0012].handoff' create`：冻结要求正文和附件索引，不复制历史全文；不改变状态。
- `'task[T-0012].handoff' attach --path <文件>`：保存手写交接。
- start 自动保存交接快照，无须紧接着 create。保存 handoff 不发送消息或启动代理。

## 用途与移除

`attach --audience user` 排除代理读取，仍在 HTML 展示；已有绑定用 `.output set-audience --path <路径> --audience user` 更新同路径全部版本。它不控制 GitHub 发布，也不撤回已发布评论。

`.output remove --path <路径>` 移除同路径全部附件版本，保留磁盘文件；content 用 `.content remove`。`.output add --path <路径>` 可提前登记产物。

路径、历史快照及用途排除见[上下文](context.md)；发布与同步见[GitHub](../github-sync.md)。
