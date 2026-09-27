# Task Graph

面向主控与执行 Agent 的本地任务图工具：用 CLI 管理任务要求、依赖、子图、领取、报告与交接，生成可离线阅读的 HTML 看板。可按入口图开启 GitHub issue 自动同步。

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

本仓库同时维护三个配套入口：

- [task-graph](SKILL.md)：CLI、任务图和 HTML。
- [to-task](skills/to-task/SKILL.md)：供主控拆分和编写任务。
- [task-take](skills/task-take/SKILL.md)：供执行者接手、记录上下文和交付。

可将相应目录链接到本机技能目录。task-take 也会由 CLI 返回实际路径。验证主控到执行者的配套流程可运行 `npm run test:workflow`。

## 快速开始

下面从工具目录执行；将 `/path/to/project` 替换为要管理的项目根目录。

```sh
node dist/src/cli.js init --name "示例项目" --cwd /path/to/project --json
node dist/src/cli.js graph add --entry --title "功能交付" --cwd /path/to/project --json
```

在目标项目写好 `doc/tasks/implementation.md`，包含完整要求和可检查的完成条件。用上一步返回的图 ID 创建任务；新项目通常为 `G-001`：

```sh
node dist/src/cli.js task add --graph G-001 --summary "实现功能" --content doc/tasks/implementation.md --cwd /path/to/project --json
node dist/src/cli.js task list --available --cwd /path/to/project --json
node dist/src/cli.js task show T-0001 --handoff --cwd /path/to/project --json
```

任务 ID 使用实际返回值。多项依赖可重复传 `--depends-on`；批量计划使用 `task add --from <plan.json绝对路径>`。

`task show`、`task start` 默认提供 `context` 地址清单：完整要求、参考文件、已有交接和报告。前置任务用 `task reference attach <ID> --path <项目内文件> --summary "用途"` 登记参考后，后继沿依赖自动取得其路径与摘要；无需复制文件登记。reference 默认 live，可用 `--snapshot` 固定版本。四类附件 reference/report/log/handoff 均支持可选 summary，HTML 标签也会显示它。

`show` 与 `show --handoff` 默认不展开正文，可用 `--manifest` 明确指定；需要时传 `--expand content --expand report` 或 `--expand-path <文件>`，先加 `--preview` 查看体量。用 `--exclude-path <精确路径>` 排除文件；仅供用户的附件在 attach 时加 `--audience user`，已有附件用 `task output set-audience` 补标。HTML 仍可阅读这些附件。旧版自动聚合 handoff 默认隔离，详见 [交接与用途规则](references/controller-workflow.md)。

成功修改会生成目标项目中的 `.task-graph/generated/index.html`。直接编辑要求文件后，执行 `build --cwd /path/to/project` 刷新视图。

## GitHub 同步

创建入口图时加 `--gh`，也可对已有图开启：

```sh
node dist/src/cli.js graph publish G-001 --repo owner/repo --cwd /path/to/project --json
```

开启后，后续任务自动发布为子 issue，依赖使用原生关系，文本报告、日志和交接自动发布为评论。子图复用其父任务 issue。远程失败时本地修改保留，返回 `github.status: pending`；下一次修改或 build 自动重试，也可运行 `github sync`。

图片、PDF 等二进制附件只发布文件名和摘要信息；原文件保留在本地。保留并备份 `.task-graph/github-sync.json`，它包含远程映射与待发评论。完整行为见 [GitHub 同步参考](references/github-sync.md)。

## 文档与验证

- [Agent 使用流程](SKILL.md)：首次接手、创建、派工、交付与错误处理。
- [主控接口参考](references/controller-workflow.md)：批量计划、稳定 key、子图、局部完成点及附件快照。
- `to-task` 是可选的配套规划 Skill，独立于本仓库；直接使用本 CLI 无需它。

```sh
npm test
node dist/src/cli.js skill validate --json
```

测试使用隔离的临时项目；GitHub 同步测试使用模拟接口，不向真实仓库发布 issue。工具记录 Agent 的领取与状态，Agent 的启动和调度由主控所在环境负责。
