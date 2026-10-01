# 准备与定位

仅在首次使用、入口缺失或更换项目时读取。

工具根目录含 SKILL.md、package.json 和 dist/src/cli.js；项目根目录是要管理的 checkout，数据在其 .task-graph/ 下。本包的 skills/* 若通过 junction/symlink 安装，先解析真实目标，再向上两级找到工具根；不要按技能安装别名的父目录猜路径。执行者优先使用派工/CLI 给出的绝对入口。

本文档库中的 CLI 是 `node "<工具根目录>/dist/src/cli.js"` 的缩写，不是已安装的命令。每条命令带 `--cwd "<实际项目根目录>"`，结构化输出加 `--json`。Node 版本以 package.json 为准；缺少依赖时在工具根运行 npm ci，缺 dist 时 npm run build。

```text
CLI graph list --cwd "<项目>" --json
CLI task list --cwd "<项目>" --json
CLI . describe --cwd "<项目>" --json
```

已有项目复用现有图和任务 ID。新项目才运行 `. init --name "<项目名>"`，需要入口图时 `graph add --entry --title "<交付>"`；`init --task "<根任务>"` 可一并创建入口图和根任务。记录返回 ID，不预测编号。

任务正文和附件路径相对项目根目录；批量 `--from` 相对调用目录，建议传绝对路径。资源地址统一加引号，如 `'graph[G-001].task[T-0001]'`；只知道任务 ID 时用 `'task[T-0001]'`。细节查 [资源地址](../resource-cli.md)。

已确认 PRD 如需结构化溯源，可 `source add --id PRD-001 --file <项目相对路径> --confirmed-at <确认时间>`，建任务用 `--derived-from PRD-001`。来源可选，不替代执行依赖。从聊天开始时把确认要求写成 content 即可。

所有写入检查退出码和 ok；失败读取 error.code/message/details。创建回执不确定时查询或使用相同稳定 key 重试。GitHub pending 表示本地保存成功，远程恢复见 [GitHub 同步](../github-sync.md)。
