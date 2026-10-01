# Task Graph

面向主控与执行 Agent 的本地任务图工具：用 CLI 管理任务要求、依赖、子图、领取、报告与交接，生成可离线阅读的 HTML 看板。可按入口图开启 GitHub issue 自动同步。

0.3.0 增加 [contract 节点、条目式 reference 和一次决策登记](references/operations/contracts.md)。任务放行指纹仍停用，保留 refine/unrefine 和执行依赖检查。实际返工用 [record-error](references/error-book.md) 登记；执行者仅提交本任务修改，提交命名见[交付规则](references/operations/delivery.md)。

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

本仓库维护五个角色入口，各 SKILL.md 只路由当前需要的工作流与操作手册：

- [task-graph](SKILL.md)：CLI、任务图和 HTML。
- [to-task](skills/to-task/SKILL.md)：供主控拆分和编写任务。
- [to-active-task](skills/to-active-task/SKILL.md)：供主控先建骨架、按实际前置交付逐步细化，与 to-task 二选一。
- [task-take](skills/task-take/SKILL.md)：供执行者接手、记录上下文和交付。
- [task-review](skills/task-review/SKILL.md)：供持有 review-id 的独立审查者验证与交卷；启动提示词自动提供入口。

可将相应目录链接到本机技能目录。配套 Skill 共用本仓库的 references，安装时保留完整仓库布局；通过 junction/symlink 使用时按真实目标解析相对链接，单独复制某个 skills 子目录不能构成完整安装。task-take 也会由 CLI 返回实际路径。验证主控到执行者的配套流程可运行 `npm run test:workflow`。

`references/workflows/` 说明角色职责和判断原则；`references/operations/` 按功能提供命令、前提与恢复方法。按当前角色和操作读取，不需要通读整套文档。

## 快速开始

生成的 HTML 默认使用 ELK 自动横向排版：减少连线交叉、绕开卡片，并将没有当前视图连线的节点单独排列。右上角可切换纵向或隐藏契约引用；隐藏引用只影响显示。选中任务或契约会突出其相邻连线，原有详情、章节、筛选和子图导航保持可用。布局引擎随 HTML 内嵌，离线打开无需联网；首次计算完成后自动适配画布，缩放不触发布局重算。若排版失败，页面保留基础布局并显示提示。

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

- [角色与操作路由](SKILL.md)：选取本次工作所需材料。
- [主控操作索引](references/controller-workflow.md)：批量计划、关系、材料和维护。
- [动态操作索引](references/dynamic-workflow.md)：思想、细化、验收和通知的按需入口。
- [独立审查索引](references/review.md)：区分主控配置与 reviewer 交卷。

```sh
npm test
node dist/src/cli.js skill validate --json
```

测试使用隔离的临时项目；GitHub 同步测试使用模拟接口，不向真实仓库发布 issue。普通任务由主控所在环境派工；显式启用自动审查或手动启动 review 时，工具会启动并监控独立审查者。


## 独立审查

任务可绑定多份 `.review-requirement`。为任务启用 `.auto-review`，或通过图的一次性扫描开启后，执行者 complete 会进入 `pending_review` 并触发审查，确认审查线程启动后自动转为 `reviewing`；主控也可在普通任务完成后调用 `'task[T-0001].review' start`。审查者通过 `.review finish` 提交 pass/reject/blocked；用法与通知范围见 [独立审查](references/review.md)。
