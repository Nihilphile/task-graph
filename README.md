# Task Graph

面向主控与执行 Agent 的本地任务图工具：用 CLI 管理任务要求、依赖、子图、领取、报告与交接，生成可离线阅读的 HTML 看板。可按入口图开启 GitHub issue 自动同步。

## 资源地址 CLI

优先使用 `CLI 'graph[G-001].task[T-0012]' <动作>`；只知道任务 ID 时可用 `task[T-0012]`。图中的任务集合是 `graph[G-001].task`，材料集合包括 `.content`、`.review-requirement`、`.reference`、`.report`、`.log`、`.handoff`、`.output`，依赖集合是 `.dependency`；独立审查使用任务的 `.auto-review`、`.review` 和图的 `.auto-review`。子图任务可用 `graph[G-001].task[T-0001].subgraph.task[T-0002]`。地址中的归属会被校验；ID 使用实际返回值。

用 `CLI . describe` 发现入口，`CLI graph list` 找到图，`CLI '<资源地址>' describe` 查看操作和条件。所有调用带项目 `--cwd`；结构化输出加 `--json`。CLI 是 `node "<工具目录>/dist/src/cli.js"` 的缩写。

完整示例、批量计划范围、材料清单与旧命令映射见 [资源地址 CLI](references/resource-cli.md)。单图且没有 `parent_task` 的计划用 `'graph[G-001].task' add --from`；包含 `parent_task` 或跨图的计划用 `task add --from`。显式父任务创建用 `task add --parent-task`。

默认查询返回任务摘要和完整文件索引，写入返回本次变更；`--detail` 获取扩展元数据，正文用 `--expand` 显式选择。字段与调用方迁移见 [CLI 输出约定](references/cli-output.md)。

## 接手与受阻

前置依赖或动态细化尚未完成时，`readiness=unready`，不能开工。执行中遇到问题则 `status=blocked`；blocked 本身不阻止接手。对 blocked 任务成功 start/reopen/claim/reassign 后，状态进入 in_progress，旧阻塞原因归档并返回 repair 回执；仍无法继续时再次 block，即使同一原因也会产生新的订阅通知。重审原交付用 review restart，接手修改交付则先 start 再 complete。

## 安装

需要 Node.js；建议使用 Node.js 22 或更高版本进行开发和测试。CLI 运行要求见 `package.json`。GitHub 同步另外需要已登录的 GitHub CLI (`gh`)。

```sh
gh repo clone Nihilphile/task-graph
cd task-graph
npm ci
npm run build
node dist/src/cli.js help
```

`dist/` 为本地构建产物，不随源码提交。把本目录作为 Skill 安装时，先完成上述构建，Agent 入口是 [SKILL.md](SKILL.md)。

本仓库同时维护四个配套入口：

- [task-graph](SKILL.md)：CLI、任务图和 HTML。
- [to-task](skills/to-task/SKILL.md)：供主控拆分和编写任务。
- [to-active-task](skills/to-active-task/SKILL.md)：供主控先建骨架、按实际前置交付逐步细化，与 to-task 二选一。
- [task-take](skills/task-take/SKILL.md)：供执行者接手、记录上下文和交付。

可将相应目录链接到本机技能目录。task-take 也会由 CLI 返回实际路径。验证主控到执行者的配套流程可运行 `npm run test:workflow`。

## 快速开始

下面从工具目录执行；将 `/path/to/project` 替换为要管理的项目根目录。

```sh
node dist/src/cli.js . init --name "示例项目" --cwd /path/to/project --json
node dist/src/cli.js graph add --entry --title "功能交付" --cwd /path/to/project --json
```

在目标项目写好 `doc/tasks/implementation.md`，包含完整要求和可检查的完成条件。用上一步返回的图 ID 创建任务；新项目通常为 `G-001`：

```sh
node dist/src/cli.js 'graph[G-001].task' add --summary "实现功能" --content doc/tasks/implementation.md --cwd /path/to/project --json
node dist/src/cli.js task list --available --cwd /path/to/project --json
node dist/src/cli.js 'task[T-0001]' show --handoff --cwd /path/to/project --json
```

任务 ID 使用实际返回值；新资源入口的任务响应也返回可复用的 `task.resource`。多项依赖可重复传 `--depends-on`；单图批量计划使用 `'graph[G-001].task' add --from <plan.json绝对路径>`，跨图或 `parent_task` 计划使用 `task add --from`。

`'task[T-0001]' show`、`'task[T-0001]' start` 默认提供 `context` 地址清单：完整要求、参考文件、已有交接和报告。前置任务用 `'task[T-0001].reference' attach --path <项目内文件> --summary "用途"` 登记参考后，后继沿依赖自动取得其路径与摘要；无需复制文件登记。reference 默认 live，可用 `--snapshot` 固定版本。四类附件 reference/report/log/handoff 均支持可选 summary，HTML 标签也会显示它。

`show` 与 `show --handoff` 默认不展开正文，可用 `--manifest` 明确指定；需要时传 `--expand content --expand report` 或 `--expand-path <文件>`，先加 `--preview` 查看体量。用 `--exclude-path <精确路径>` 排除文件；仅供用户的附件在 attach 时加 `--audience user`，已有附件用 `'task[T-0001].output' set-audience` 补标。HTML 仍可阅读这些附件。旧版自动聚合 handoff 默认隔离，详见 [交接与用途规则](references/controller-workflow.md)。

成功修改会生成目标项目中的 `.task-graph/generated/index.html`。直接编辑要求文件后，执行 `node dist/src/cli.js . build --cwd /path/to/project --json` 刷新视图。

## Error-book

每次 reject 通过 `--error-report <文件.md>` 提交一份简短失败复盘。工具将其随结果保存为快照，并追加到图内独立的 error-book 方块；点击按时间阅读，可跳回对应任务。当前版本只追加小报告，不做模式统计。CLI 支持 `errorbook list/show` 和 `'graph[G-001].errorbook' list/show`。详见 [error-book 指南](references/error-book.md)。

## GitHub 同步

创建入口图时加 `--gh`，也可对已有图开启：

```sh
node dist/src/cli.js 'graph[G-001]' publish --repo owner/repo --cwd /path/to/project --json
```

开启后，后续任务自动发布为子 issue，依赖使用原生关系，文本报告、日志和交接自动发布为评论。子图复用其父任务 issue。远程失败时本地修改保留，返回 `github.status: pending`；下一次修改或 build 自动重试，也可运行 `github sync`。

图片、PDF 等二进制附件只发布文件名和摘要信息；原文件保留在本地。保留并备份 `.task-graph/github-sync.json`，它包含远程映射与待发评论。完整行为见 [GitHub 同步参考](references/github-sync.md)。

## 文档与验证

- [Agent 使用流程](SKILL.md)：首次接手、创建、派工、交付与错误处理。
- [主控接口参考](references/controller-workflow.md)：批量计划、稳定 key、子图、局部完成点及附件快照。
- [动态工作流与 Desktop watch](references/dynamic-workflow.md)：多文件 Content、refine、pass/reject 和通知恢复。
- [独立审查](references/review.md)：RR、自动/手动启动、审查结论和异常恢复。

```sh
npm test
node dist/src/cli.js skill validate --json
```

测试使用隔离的临时项目；GitHub 同步测试使用模拟接口，不向真实仓库发布 issue。普通任务由主控所在环境派工；显式启用自动审查或手动启动 review 时，工具会启动并监控独立审查者。


## 独立审查

任务可绑定多份 `.review-requirement`。为任务启用 `.auto-review`，或通过图的一次性扫描开启后，执行者 complete 会进入 `pending_review` 并触发审查，确认审查线程启动后自动转为 `reviewing`；主控也可在普通任务完成后调用 `'task[T-0001].review' start`。审查者通过 `.review finish` 提交 pass/reject/blocked；用法与通知范围见 [独立审查](references/review.md)。
