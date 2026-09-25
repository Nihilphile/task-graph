---
name: task-graph
description: >-
  维护项目任务图：通过 CLI 创建任务、绑定任务要求和报告、建立执行依赖、记录领取与状态，
  并生成离线可读的 HTML。适用于从已确认的 PRD 或聊天任务建图、接手已有任务图、
  维护任务及子图、登记交付、校验与构建视图。
---

# Task Graph（任务图）

本 Skill 面向首次使用此工具的主控和执行 Agent。按下面的步骤，可以从接手项目走到任务交付；批量建图和特殊关系再查文末参考。

需要把 PRD、spec 或已确认对话拆成可独立验收的任务时，可先使用 `$to-task` 生成完整要求和批量计划，再由本 CLI 落图。已有明确任务直接使用下面的命令即可。

## 这个工具管理什么

主控用 CLI 把任务要求、先后依赖、执行者和交付文件关联到同一个任务 ID。工具将这些记录生成只读 HTML，供人查看进度、阅读要求和报告。

- **任务（task）**：一项可交付工作，自动分配 ID，例如 `T-0001`。摘要显示在节点上，完整要求放在你编写的 Markdown 文件中。
- **图（graph）**：一组任务及它们的关系，自动分配 ID，例如 `G-001`。入口图是浏览起点；某个任务下面的细分工作放在子图中，该任务称为复合任务。
- **依赖（depends_on）**：例如 B 依赖 A，表示 A 完成后 B 才能开始。一个任务可依赖多个前置任务，所有依赖都满足才就绪。工具拒绝循环依赖。
- **状态与就绪**：`status` 是已记录的 todo（待开始）、in_progress（执行中）、done（完成）、cancelled（取消）；`readiness` 是根据依赖和人工阻塞计算的 ready 或 blocked。ready 本身不表示任务待执行。
- **领取（claim）**：记录由哪个角色、哪个实际 Agent 会话负责。领取本身不启动 Agent。
- **交接（handoff）**：把完整要求、前置产物和已有进展汇成一份可交给执行者的上下文；可以只预览，也可以保存当时的快照。

Task Graph 不负责启动或停止 Agent、检测会话失败、自动释放领取、重试或重新调度。主控使用所在环境的调度工具完成派工，并在本工具记录责任人和结果。

## 1. 找到入口与目标项目

用户可显式调用 `$task-graph`，也可要求创建、接手或维护任务图。按已有授权执行；任务范围或关键依赖尚不明确时先澄清，已经确认的工作继续推进。

先确定两个不同目录：

- **Skill 目录**：本 `SKILL.md` 所在目录，包含工具程序。
- **项目根目录**：要管理的项目，任务图数据存放在它的 `.task-graph/` 中。

所有命令都通过下面的入口运行，不依赖全局安装：

```text
node "<Skill目录>/dist/src/cli.js" help
node "<Skill目录>/dist/src/cli.js" task list --cwd "<项目根目录>" --json
```

将尖括号占位符替换为实际绝对路径。以下例子使用 **CLI** 作为上述 `node "<Skill目录>/dist/src/cli.js"` 的文字缩写；它不是已安装的命令。每次调用都带上项目 `--cwd`。

需要 Node.js 20.11 或更高版本。若 Skill 目录缺少依赖，先在该目录运行 `npm ci`；若缺少 `dist/src/cli.js`，运行 `npm run build`。能执行 `help` 后再操作项目。

## 2. 接手已有项目，或创建新项目

**已有项目**：发现 `<项目根目录>/.task-graph/project.yaml` 后，读取它获得图 ID，执行：

```text
CLI validate --cwd "<项目根目录>" --json
CLI task list --cwd "<项目根目录>" --json
CLI task show T-0001 --cwd "<项目根目录>" --json
```

最后一条的 ID 替换为当前要接手的任务。先看当前状态、领取和阻塞，再决定继续执行、补充记录还是调整计划。已有项目用 add/revise 扩展，保留现有任务 ID。

**新项目**：确认工作范围后创建项目和入口图：

```text
CLI init --name "示例项目" --cwd "<项目根目录>" --json
CLI graph add --title "功能交付" --entry --cwd "<项目根目录>" --json
```

后续使用返回的图 ID；下文以新项目的 `G-001` 为例。任务和图 ID 均从命令返回结果读取，不预测下一个编号。

- **从 PRD 开始**：在建任务前，用 `source add --id PRD-001 --file <项目相对路径> --confirmed-at <确认时间>` 登记已确认的需求文档；创建任务时可用 `--derived-from PRD-001` 记录来源。来源记录可选，不影响执行依赖。
- **从聊天任务开始**：直接把确认后的要求写入下一步的内容文件。若需要一个统领子任务的根任务，也可用 `init --name <项目名> --task <根任务标题>` 一次创建项目、入口图和根任务。

完成本步骤时，应已知道项目路径、要使用的图 ID，以及这次是创建工作还是接续已有工作。

## 3. 写一次完整要求，再绑定任务

先在项目内创建文件，例如 `doc/tasks/implementation.md`，写清执行者需要知道的目标、范围、输入、约束、完成条件与交付位置。正文格式自由；下面仅是最小示例：

```markdown
# 实现功能

## 目标
实现已确认的功能行为。

## 完成条件
相关检查通过，提交验证结果和未解决问题。

## 交付
把报告写到 doc/reports/implementation.md。
```

然后创建任务：

```text
CLI task add --graph G-001 --summary "实现功能" --content doc/tasks/implementation.md --cwd "<项目根目录>" --json
```

记录返回的 `task.id`，假设是 `T-0001`。验证任务先写好自己的要求文件，再创建并声明依赖：

```text
CLI task add --graph G-001 --summary "独立验证" --content doc/tasks/verification.md --depends-on T-0001 --cwd "<项目根目录>" --json
```

多依赖用重复的 `--depends-on`，最终保存为数组。CLI 管理编号、状态和关系；`--content` 指向的文件就是执行者与 HTML 共用的完整要求，无须再写一份重复的派工正文。

路径规则：`--content`、报告及日志的 `--path`、`--report` 都相对项目根目录，绑定时文件须已存在。只有批量计划的 `--from` 路径相对命令调用时的工作目录；传绝对路径可避免混淆。

完成本步骤后，用 `task show <返回的ID> --json` 核对摘要、要求路径和依赖。

## 4. 派工、记进展、交付

```text
CLI task list --available --cwd "<项目根目录>" --json
CLI task show T-0001 --handoff --cwd "<项目根目录>" --json
```

`--available` 只返回 todo、ready 且未领取的任务。`show --handoff` 只生成交接预览，不创建文件，也不改变状态。执行者只拿到 task ID 时，也从这两类查询恢复上下文。

列表可能同时包含复合父任务和子任务：父任务 ready 表示可以开始统筹，完成它仍须满足子任务完成目标。派工前用 `task show <ID> --json` 查看 `task.subgraph` 和要求，区分父任务的统筹职责与子任务的具体工作，避免重复派发同一范围。

主控通过当前环境的调度方式交付任务：提供项目路径、CLI 入口、task ID，以及上述完整交接内容或任务要求路径。获得实际执行会话 ID 后记录开始：

```text
CLI task start T-0001 --role implementer --session-id "<实际会话ID>" --cwd "<项目根目录>" --json
CLI task log T-0001 --text "实现完成，正在验证" --cwd "<项目根目录>" --json
```

`start` 同时领取、改为执行中并保存交接快照；role/session-id 成对提供。它会拒绝未就绪任务和冲突的领取。执行者自行开始时同样使用自己的实际会话 ID；同一次执行由主控或执行者中的一方记录开始即可。

执行者写好报告，主控或执行者按已约定的验收责任确认完成条件后：

```text
CLI task complete T-0001 --report doc/reports/implementation.md --log "验证通过，报告已提交" --cwd "<项目根目录>" --json
CLI task show T-0001 --cwd "<项目根目录>" --json
```

`--report` 可重复传入多份报告。报告快照、工作记录、完成状态和结束领取在同一事务中保存。工具检查状态与图约束；报告内容是否满足业务要求由负责验收的人或 Agent 判断。复合任务的完成目标全部完成后，还需显式 complete 父任务。

如果已有其他执行者领取，先核查其进展，需要接替时使用 `task reassign`；领取不会自动过期。遇到外部阻塞，使用 `task block` 记录原因，解除时用 `task unblock`。详细参数通过 `CLI help "命令名"` 查看。

## 5. 阅读与交付 HTML

成功的结构化修改自动校验并重建视图。任务要求及 Markdown 正文可直接编辑；直接编辑文件后执行：

```text
CLI validate --cwd "<项目根目录>" --json
CLI build --cwd "<项目根目录>" --json
```

把 `<项目根目录>/.task-graph/generated/index.html` 的实际路径交给用户。HTML 只读，不承担回写编辑。

单击节点局部放大，再点同一主体、空白处或按 Esc 恢复；双击复合任务进入子图。任务要求标签打开完整正文；报告、工作记录、交接标签先显示文件列表，再打开具体文件。旧任务无外部 content 时读取自身 Markdown 正文。

完成操作后，报告修改的 task ID、校验结果和 HTML 路径；若尚有阻塞，一并说明。查询即可回答的问题只执行查询。

## 数据保存与错误处理

### 可选：自动发布到 GitHub

用户希望在 GitHub 跟踪任务时，在创建入口图的命令上加 `--gh`：

```text
CLI graph add --title "功能交付" --entry --gh --cwd "<项目根目录>" --json
```

需要已登录的 `gh`；默认从项目 Git remote 确定仓库，也可传 `--repo owner/repo`。已有入口图用 `CLI graph publish G-001 --repo owner/repo --cwd "<项目根目录>" --json` 开启。

开关保存在图上。之后正常 add/start/log/report/complete 即会自动发布：入口图是总 issue，任务是子 issue，报告、工作记录和交接是评论。子图继承开关并复用所属父任务的 issue。Agent 无须另行调用 gh。

本地保存成功但 GitHub 失败时，退出码仍为 0、`ok: true`，另有 `github.status: "pending"`。报告时区分本地完成和远程待同步；下一次修改/build 会补发，也可运行 `CLI github sync --cwd "<项目根目录>" --json`。查询命令保持只读。接手已开启的图继续使用这个设置即可。

仓库绑定、附件发布范围、失败恢复和同步边界见 [GitHub 同步参考](references/github-sync.md)。

```text
<项目根目录>/
  doc/tasks/...md         # 示例要求路径，可自行安排
  .task-graph/
    project.yaml          # 图注册信息、入口图与可选需求来源
    tasks/T-NNNN.md        # YAML frontmatter（结构化字段）和任务正文
    logs/T-NNNN.md         # 工具维护的默认工作记录
    snapshots/            # 报告与交接的文件快照
    github-sync.json      # 启用 GitHub 后的 issue 映射与待发评论；需保留
    generated/graph.json  # 生成的数据
    generated/index.html  # 生成的只读视图
```

结构化字段和关系用 CLI 修改；`readiness`、`blocked_by` 由源文件计算，不手写回任务文件。HTML 和 graph.json 可重新生成。

自动化调用加 `--json`，检查退出码和 `ok`。错误返回 `error.code`、`message`、`details`；修正对应输入或文件后重试。创建请求结果不确定时，先查询确认，或按参考文档使用稳定 key 重试，避免重复建任务。

## 何时查参考文档

[主控接口参考](references/controller-workflow.md) 延续本文件的概念与 CLI 入口。遇到以下情况再读对应章节：

- 一次创建多个互相引用的任务，或需要安全重试：读“批量创建”。
- 给任务拆子图，或只等待父任务的某一部分：读“子图与命名完成点”。
- 附加多份报告、日志或交接，确认版本保存方式：读“分类文件与快照”。
- 修改已有要求、迁移旧任务：读“修订与旧任务”。

## 命令索引

按操作查找；完整参数以 `CLI help "task add"` 等单命令帮助为准。

| 命令 | 作用 |
| --- | --- |
| `init` | 创建 `.task-graph/`；使用 `--task` 时同时创建入口图和根任务 |
| `graph add` | 用 `--entry` 创建入口图，或用 `--parent-task T-NNNN` 创建子图 |
| `graph publish` | 为已有入口图开启 GitHub 自动发布；后续任务继承 |
| `github sync` | 补发启用图的待同步内容，并刷新 HTML 状态 |
| `task add` | 通过摘要、要求路径和依赖数组创建任务；支持 `--from` 批量事务和稳定 key |
| `task revise` | 原地修订任务；使用 `--replace` 时取消旧任务并创建替代任务 |
| `task log` | 追加默认工作记录；旧任务已有的正文工作记录继续可用 |
| `task report attach` | 附加一份报告，保留交付快照 |
| `task log attach` | 附加独立的工作记录文件 |
| `task handoff attach` | 附加独立交接文件，保留交付快照 |
| `task handoff create` | 保存当前要求、前置产物和进展的交接快照 |
| `task output add` | 登记项目根目录相对路径的结构化产物；文件可稍后创建 |
| `task output remove` | 移除指定路径的产物记录（包括同路径多个版本），保留文件 |
| `task list` | 从源文件列出任务、状态、就绪状态与阻塞原因；支持 `--json` 和筛选 |
| `task show` | 从源文件查看单个任务的正文、产物、历史与阻塞原因；支持 `--json` |
| `task start` | 将 `todo` 改为 `in_progress`；已完成任务须显式重新打开 |
| `task complete` | 完成任务并结束领取；可同时附加报告和记录；复合任务须满足完成目标 |
| `task cancel` | 取消 `todo` 或 `in_progress` 任务；`cancelled` 为终态 |
| `task reopen` | 显式将 `done` 任务重新打开为 `in_progress` |
| `task claim` | 记录领取角色、`session_id` 和 `claimed_at` |
| `task release` | 显式清除当前领取 |
| `task reassign` | 重派或通过 `--takeover` 接管任务，并保留领取历史 |
| `task link` | 建立完全依赖；用 `--gate` 建立指向复合任务完成点的部分依赖 |
| `task unlink` | 移除指定依赖 |
| `task block` | 添加无法由 DAG 表达的人工阻塞原因 |
| `task unblock` | 移除一个人工阻塞原因 |
| `task attach-subgraph` | 将已注册的非入口图附加到任务 |
| `task set-completion` | 设置复合任务的完成目标 |
| `task expose-gate` | 公开供部分依赖使用的命名完成点 |
| `source add` | 登记可选的 PRD 来源及确认时间 |
| `validate` | 报告结构问题及对应文件、字段 |
| `build` | 重新生成 `graph.json` 和 `index.html` |
| `skill validate` | 核对本 Skill 文档与实际注册的 CLI 命令 |
| `help` | 查看命令列表或单个命令的用法 |
