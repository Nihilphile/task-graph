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
