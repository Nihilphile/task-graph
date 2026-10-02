# CLI 定位与保存规则

首次接入、入口缺失或更换项目时读取。本文仅提供操作协议，规划流程由 matt-task 的两个阶段定义。

## 工具与项目

优先使用用户给出的 CLI 入口；否则查找已安装 task-graph，解析 junction/symlink 的真实工具根，确认有 package.json、SKILL.md 和 dist/src/cli.js。本技能是独立目录，不能从其父目录推断工具位置。

`CLI` 是 `node "<工具根>/dist/src/cli.js"` 的缩写，不是保证存在的命令别名。每次带 `--cwd "<权威图项目根>" --json`，资源地址加引号。通过资源 describe 或动作 --help 查询参数；只查操作手册，不再叠加 task-graph/to-task 的角色工作流。

先检查项目有无 `.task-graph`。已有数据时查询 graph list、task list、contract list，复用目标图和实际 ID；多个候选且无法推断目标时明确询问，不能自行选择其他功能的图。

新项目才初始化；已有项目需要新图时只 graph add：

```text
CLI . init --name "<项目名>" --cwd "<图项目>" --json
CLI graph add --entry --title "<功能计划>" --cwd "<图项目>" --json
```

仅生成 spec 也需要其 contract 的所属图，允许创建必要容器，不顺带创建施工任务。任务正文与契约路径相对图项目根。独立 checkout 环境使用既定权威图位置，不初始化副本。

## 回执与查询

检查退出码和 JSON ok；失败读取 error.code/message/details。数据 saved=true、view.status=failed 时已保存，单独 build 修复页面；回执不确定先查询，不盲目重复创建。

contract add 没有稳定 key，用查询核对避免重复；task 批量 add 使用稳定 key 和原参数支持幂等重试。只把成功返回的 G/C/T 编号用作后续 ID。

show/list 默认可能仅返回索引。读取当前 context 提供的 read_path，路径相对 context.project_root；mode=snapshot 时读取该快照，不能改读来源的新版本。绑定任务全部必读要求应可由索引定位，必要时 `show --expand content --expand contract` 核查。

结构化字段、关系和绑定通过 CLI 修改。只改 Markdown 正文后执行：

```text
CLI . validate --cwd "<图项目>" --json
CLI . build --cwd "<图项目>" --json
```

成功结构化修改自动重建 HTML；生成物为 `.task-graph/generated/index.html`，是只读投影。validate 只检查结构，spec 覆盖和任务可独立接手由规划阶段检查。

本地任务图是数据来源。用户已授权远程发布时查工具根 references/github-sync.md 并使用已有同步，不另通过原 Matt 技能或 gh 创建第二套任务。未要求发布时保持本地操作。
