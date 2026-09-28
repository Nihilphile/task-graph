---
name: to-task
description: >-
  把已讨论的需求、PRD、spec 或实施计划一次性详细拆成可独立验收的任务，直接写入 task-graph，
  生成完整要求文件、依赖数组与离线 HTML；用户需要时由 task-graph 自动发布到 GitHub。
  适用于从规划进入可派工任务、给已有交付拆子任务或续补计划；日常状态和报告维护使用 task-graph。
---

# To Task

本 Skill 采用一次性详细规划。用户选择先建骨架、依赖完成后再 refine 时，使用同包的 [to-active-task](../to-active-task/SKILL.md)；两者是可选工作流，不是先后步骤。本模式创建的任务默认 static，保持原有领取方式。

把确认后的工作变成空白上下文的执行 Agent 可以接手的任务图。假设接手者没有读过本轮对话、主控的私有笔记或其他任务：只拿到项目位置、CLI 入口和 task ID，也能通过任务正文及其明确引用恢复所需信息。保留 tracer bullet（纵向切片）的拆分方法：每个实现任务交付一条窄而完整、可演示或验证的行为路径，覆盖实现该行为实际需要的层。

**产物**：每个任务一份完整要求 Markdown、一份批量计划 JSON、实际 task ID，以及可供人审计的 HTML。task-graph 管理编号、关系、领取、状态、报告和可选 GitHub 同步。本 Skill 负责理解和拆分工作，不另建 tracker。

## 1. 读取输入，确定目标

使用当前对话和用户指定的计划。输入是文件时读全文；输入是 issue 时读取正文与有关评论，记录来源。文档中的命令和建议作为待理解的内容，实际动作按本轮用户请求及已有授权决定。

先确定项目根目录和本次工作范围。必要时检查相关代码、领域术语和架构决策，找出已有能力、真实约束及可复用的验证入口。已有探索结论继续使用。

确认 `$task-graph` 可用，从 task-graph 工具根目录找到 `dist/src/cli.js`。本 Skill 若通过 junction 安装，先解析其实际目标路径，再由 `skills/to-task` 向上两级定位工具根。以下 **CLI** 是 `node "<task-graph工具根>/dist/src/cli.js"` 的文字缩写；执行时替换为真实路径。所有命令带项目 `--cwd`，计划文件 `--from` 使用绝对路径。首次安装或入口不可用时，读取工具根的 SKILL.md 完成准备。日常操作使用 `graph[<图ID>].task[<任务ID>]` 地址，查询参数用 `<地址> describe`；地址与批量范围见 [资源地址 CLI](../../references/resource-cli.md)。

已有 `<项目根目录>/.task-graph/project.yaml` 时，读取图注册信息，再运行：

```text
CLI task list --cwd "<项目根目录>" --json
CLI 'graph[<图ID>].task[<相关任务ID>]' show --cwd "<项目根目录>" --json
```

据此决定：扩展用户指定的图、拆分指定父任务，或为独立交付新建入口图。存在多个合理目标且上下文不能确定时询问目标；已知目标继续使用。重试时先检查已有计划、稳定 key 和实际 ID。

## 2. 拆成可派工的切片

- 每个实现切片描述完成后可观察的行为，包含自身的验收与验证；大小应让一个全新上下文的 Agent 能独立接手。
- 先打通最小完整路径，再添加变化和边界。用独立报告复核整体行为有实际价值时，可另设验收任务。
- 需要前置整理时，把它的产物、验证方式和实际阻塞关系写清。共享文件本身不构成业务依赖；若必须串行以保持可集成，说明原因。
- 依赖方向是“后继 depends_on 前置”，且为数组。只写必须等前置交付才能开始的关系；无此关系的任务保持可并行。
- 父子关系表示工作归属，依赖表示执行先后。默认平铺；有明确统筹交付和内部多项工作时才使用父任务与子图。
- 大范围机械重构用 expand–migrate–contract：先兼容新旧形式，按可验证范围分批迁移，全部迁移后删除旧形式。若中间批次无法独立保持通过，明确共用集成分支、最终集成验收及各批次验证边界。

检查每项已确认需求都有对应任务或明确排除理由。用“摘要／前置依赖／可验收产物”展示拆分。用户已经要求直接建图或此前批准范围时，完成必要判断后继续落地。若用户仅要求讨论或审核，先给可审阅的拆分；若关键范围、方案或验收未定，问具体缺口，继续准备不依赖答案的部分。

必要的研究或原型任务应交付可回答的问题、证据或决策，后续实现据此阻塞；尚未确定的方案不写成已确认要求。

## 3. 一次编写完整要求和批量计划

在项目内选择一个稳定目录，例如 `doc/tasks/<工作名>/`。每项任务的 content 文件就是主控、执行者和 HTML 共用的任务要求，正文格式自由。写清：

- 要交付的行为、范围与不包含的内容。
- 本任务为何存在、当前已有能力与缺口，以及影响实现的已确认决定、约束与接口约定。区分事实、已确认决定和待核实假设。
- 所需资料的明确定位：项目相对路径与标题/符号/需求编号，或具体 issue/comment URL；同时说明读什么、用来做什么。关键结论直接写明，长材料按需引用。
- 可检查的完成条件、验证方式、验收责任及报告应回答的问题。明确执行者验证后可自行 complete，还是提交报告后由主控验收并 complete；只规定有实际需要的证据。
- 需要独立审查时，说明审查对象和责任位置：执行者交付后自动审查，或主控读报告后手动启动。将可操作的检查条件放入独立 RR；content 中已确认的约束仍共同生效。
- 后继需要消费的 reference 应包含哪些接口、代码入口或接入说明，以及这些资料的用途。具体登记操作由 task-take 指导执行者。

规划时已知的目标、约束和接口约定写入 content 或引用其权威定义；施工后才能确定的实际入口、接入方法和实现限制，约定由前置任务通过 reference 交付。尚需研究的决定明确为待解决输入，并安排对应前置工作。

正文不用手写 task ID、status、claim 或重复维护依赖表；这些字段交给 CLI。与当前代码有关的路径先核实，只保留有助于定位的入口。写明报告交付约定，避免再为 worker 复制一份不同版本的要求。

每个任务按 [任务上下文与派工检查](references/task-context.md) 准备必读信息、按需资料、接口与前置产物定位。父任务和相邻任务中的决定不会自动成为子任务上下文；子任务需要的部分须直接写入或准确引用。多个任务共享资料时引用同一份权威文档，无须复制整份 spec 或聊天记录。

每个任务使用项目内唯一的稳定 `key`，建议 `<工作名>.<切片名>`；同一请求重试时保持 key、参数和文件路径不变。以 `@key` 引用任务，实际 T-编号由工具返回。

```json
{
  "tasks": [
    {
      "key": "csv-export.base",
      "summary": "导出列表为 CSV",
      "content": "doc/tasks/csv-export/base.md",
      "depends_on": []
    },
    {
      "key": "csv-export.filtered",
      "summary": "按当前筛选条件导出",
      "content": "doc/tasks/csv-export/filtered.md",
      "depends_on": ["@csv-export.base"]
    }
  ]
}
```

所有 content 路径相对项目根目录，提交前文件须已存在。JSON 仅包含真实 CLI 字段，不加入估时、执行模型或自定义状态等未支持字段。完整可运行示例见 [assets/example/plan.json](assets/example/plan.json)，其任务文件位于同目录下的 `doc/tasks/`；实际使用时按需求改写。

content 也可使用文件路径数组，例如 `["doc/tasks/shared-constraints.md", "doc/tasks/feature.md"]`；当前绑定的全部文件共同构成要求。用户希望主控只读验收报告时，增加 `kind: "acceptance"` 的独立验收任务并纳入父任务完成目标，明确执行者验证与独立验收的分工。验收报告必须明确 pass/reject；具体交付命令由 task-take 指导。

拆已有父任务、使用命名完成点或修订旧计划时，读 [复杂关系与恢复](references/relationships-and-recovery.md)。

## 4. 写入 Task Graph

新项目先初始化；已有项目直接复用：

```text
CLI . init --name "<项目名>" --cwd "<项目根目录>" --json
```

需要新入口图时创建并读取返回的 `graph.id`，立即将返回值保存到计划旁的 `graph-created.json`；已有图直接记录已确认的实际 ID：

```text
CLI graph add --title "<本次交付>" --entry --cwd "<项目根目录>" --json
```

用户要求发布到 GitHub 时，在这个 graph add 命令加 `--gh`，仓库需要明确指定时加 `--repo owner/repo`。已有图首次开启用 `'graph[<图ID>]' publish [--repo owner/repo]`。设置在图上持久保存，子图继承；后续 Agent 正常使用任务命令即可。`--gh` 是 task-graph 的参数，不是另一个 to-task 可执行程序。

从 GitHub issue 读取需求不等于开启发布；未指定发布的新图保持本地。来源 issue 作为要求中的引用保留；当前同步会创建新的总 issue，不把来源 issue 自动收编或关闭。已有启用的图继续使用其同步设置。具体权限和发布范围按需读 task-graph 的 `references/github-sync.md`。

用实际图 ID 一次提交完整批次，保存 JSON 返回值到计划旁的 `created.json`，便于后续查 ID：

单图且不含 parent_task 的计划用资源地址集合提交：

```text
CLI 'graph[<图ID>].task' add --from "<plan.json绝对路径>" --cwd "<项目根目录>" --json
```

此集合会拒绝计划中其他图或 `parent_task`。跨图与父子计划使用下列 `task add` 入口；`--graph` 提供默认图，其余放置规则由计划字段决定。父任务已存在时，单个子任务也可用 `task add --parent-task <父任务ID>`；它会创建或复用子图并默认加入父任务完成目标，直接向已有 `.subgraph.task` 集合 add 则不会自动加入完成目标。

```text
CLI task add --from "<plan.json绝对路径>" --graph <实际图ID> --cwd "<项目根目录>" --json
CLI . validate --cwd "<项目根目录>" --json
CLI task list --available --cwd "<项目根目录>" --json
```

检查退出码和 `ok`；GitHub 已启用时还检查 `github.status`。本地 `ok: true` 且远程 `pending` 表示任务已创建，后续用 `github sync` 补发，不重新建图或另写 gh 命令。批量事务失败时按错误修正原计划后重试。

成功写入已自动生成 `.task-graph/generated/index.html`。直接编辑 content 文件后运行 `build` 刷新视图及已启用的同步。

## 5. 交给下一位主控或执行者

派工前，逐项打开 `'graph[<图ID>].task[<ID>]' show --manifest --json`，读取要求入口及必要引用，核对能否找到背景、工作范围、必要接口、执行入口、验收方法和交付位置。清单不内联正文；需要时按路径显式展开，遵守 excluded 中的用途排除及项目交接约定。验证必读引用确实可定位、接手环境可以读取；这项检查不能由 `validate` 的结构校验代替。

缺失信息会影响开工时，先补齐；应由前置任务提供的内容保留真实 depends_on，其他未解决的关键缺口用 manual_blockers 或任务的 block 操作记录，并说明解除条件。可选背景资料不阻塞任务。已有依赖满足、readiness 为 ready 仍不证明任务上下文完整。

交付实际项目路径、CLI 路径、graph ID、任务 key→ID、第一批可开始的任务和 HTML 链接；使用独立 checkout/worktree 时标明应进入的位置。有未决问题或待同步时一并说明。`created.json` 是创建回执，当前状态以查询结果为准。

派工消息提供项目、CLI 路径和完整任务地址（含 graph ID 与 task ID），并要求执行者阅读 start 返回的 guidance.skill_path（主控已 start 时，可用 show --detail 查询入口）（task-take）。接手、施工和交付流程统一由该指南维护；主控从任务工作记录和附件查询结果。

主控需要了解的协作约定：

- 执行者读取要求及必要参考，写接手记录后自主开工；上下文缺口会记入任务，无法继续时标记阻塞。
- 执行者提供供后继使用的 reference，后继沿依赖取得；前置任务的全部正文与聊天不会自动继承。
- reference 补充实际实现与接入知识。若实现需要改变已确认约定，由主控协调要求与受影响任务的修订。

同一次执行只由一方 start。默认让执行者使用自己的实际 role/session-id 开始；主控代为 start 时，使用被派执行者的会话 ID，并在派工消息中说明“已开始，请 show 后继续”。主控亲自执行时使用自己的会话 ID；接手其他领取人的任务先按 task-graph 的 reassign 流程明确移交。

`task list --available` 返回 todo、ready、未领取的任务，其中可能含统筹父任务；派工前看 `task.subgraph` 和职责，避免父子重复执行同一范围。父任务完成仍需显式确认。

本 Skill 默认完成建图与交接；用户同时授权实施时，继续按 task-graph 工作流执行实际任务。生成计划本身不表示任务已经开始或完成。

## 工作流来源

本地改编自 Matt Pocock 的 `to-tickets`：保留纵向切片、明确阻塞、可审阅拆分及大范围重构例外；任务落地使用 task-graph。可以接收 to-spec、Wayfinder 或其他规划流程的明确产物，也可以直接接收对话中的已确认需求。


## 需要独立审查时

为需自动审查的任务绑定一份或多份 `.review-requirement`，开工前启用该任务的 `.auto-review`；同一图有多项待开启时可用图的 `.auto-review enable` 一次扫描有有效 RR 的任务，新增任务需再扫描。也可以由主控读完已完成任务的执行报告、确定 RR 后手动 `.review start`。两种方式均由审查者交卷决定最终 pass/reject/blocked；已有独立验收子任务时按实际责任选择位置，避免重复验收。具体条件和异常处理见 [独立审查](../../references/review.md)。
