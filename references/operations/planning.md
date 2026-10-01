# 创建与批量计划

本文的 `CLI` 表示 `node "<工具根目录>/dist/src/cli.js"`；所有调用带目标项目 `--cwd`，结构化输出加 `--json`。入口未确定时读 [准备与定位](bootstrap.md)。

## 单项创建

先写好要求文件，再执行：

```text
CLI 'graph[G-001].task' add --summary "实现功能" --content docs/tasks/implementation.md --depends-on T-0001 --cwd "<项目>" --json
```

使用实际图 ID；无依赖时省略 depends-on，多依赖重复传入。要求可重复 --content；全部文件共同生效。动态骨架加 --planning dynamic，放行读 [动态细化](refinement.md)。共享规则用 `--contract C-NNNN`，已有代码入口用 `--reference R-NNNN`，均可重复；登记方式见[契约与条目](contracts.md)。要求写作读 [上下文设计](../../skills/to-task/references/task-context.md)。

## 批量创建

适用于已经确定多项任务，希望一次保存完整计划，而不是逐条创建后再连边。先创建项目和入口图，并准备各任务的完整要求文件。

单图且没有 parent_task 的批次用 `'graph[<图ID>].task' add --from <绝对路径>`；跨图或含 parent_task 的批次用 `task add --from <绝对路径> [--graph <默认图>]`。图内集合会拒绝其他图或 parent_task，不能用它创建跨图父子批次。具体父子字段见 [关系](relationships.md)。

### 一份可提交的计划

在任意位置保存 `plan.json`，以下假设项目已有入口图 G-001：

```json
{
  "graph": "G-001",
  "tasks": [
    {
      "key": "implementation",
      "summary": "实现功能",
      "content": "doc/tasks/implementation.md"
    },
    {
      "key": "verification",
      "summary": "独立验证",
      "content": "doc/tasks/verification.md",
      "depends_on": ["@implementation"]
    }
  ]
}
```

```text
CLI 'graph[G-001].task' add --from "<plan.json的绝对路径>" --cwd "<项目根目录>" --json
```

成功结果含 `ok: true`、`tasks`、`keys`、`view`。`keys.implementation` 就是实现任务的实际 ID；任务数组包含分配的 ID、图、要求路径、就绪状态等。保存返回的 ID 供后续派工使用。

`key` 是主控自选、在项目内唯一的稳定名称；`@implementation` 表示引用这个 key 对应的任务。允许引用同批后面才声明的任务，也允许引用项目里已有的 key。`key` 不取代工具分配的 T-编号。

### 字段与依赖写法

| 字段 | 用途 |
| --- | --- |
| summary | 节点上的简短描述；必需，旧字段 title 可代替 |
| content | 项目内已存在的 Markdown/text 要求路径，或路径数组；全部共同生效 |
| planning | static（默认）或 dynamic；动态任务须经主控 refine 才可开始 |
| kind | work（默认）、acceptance（独立验收）或 decision（决策） |
| key | 可选稳定名称；自动化重试时使用 |
| graph | 所属图，省略时使用计划顶层 graph |
| parent_task | 父任务 ID 或 @key；用于创建子任务，与该任务自己的 graph 二选一 |
| depends_on | 前置执行依赖数组，省略为无依赖 |
| contracts / references | 契约地址（可带 `#章节ID`）／代码入口 ID 数组，不参与执行门禁 |
| manual_blockers | 人工阻塞原因字符串数组 |
| derived_from | 已登记的需求来源 ID 数组，如 ["PRD-001"] |
| completion_requires | 父任务完成所需的子任务 ID 或 @key 数组 |
| exposes | 公开给外层依赖的命名完成点，格式见下一节 |

数组中的每项依赖都必须满足。例如：

```json
"depends_on": [
  "@implementation",
  "T-0008",
  { "task": "T-0009", "gate": "api-ready" }
]
```

字符串可写 `T-0009:api-ready` 或 `@parent:api-ready`。没有 gate 时为 full（等待整个前置任务 done）；有 gate 时为 partial（等待该完成点的目标全部 done）。也可显式提供 `mode: "full"` 或 `mode: "partial"`，与 gate 用法保持一致。

计划文件路径相对命令调用目录解析；其中 content 相对项目根目录解析。CLI 的 `--graph` 可为未在计划中指定图的任务提供默认图；它不覆盖 parent_task 决定的归属。

### 重试与失败

同一个 key、相同创建参数重试，返回已有 ID。已创建任务后来被 revise，不会因此重新创建。改变原创建参数后再使用同一 key 会报 `E_KEY_CONFLICT`；修改已存在任务使用 revise。

任一任务或最终关系校验失败，整批源文件回滚；成功后只构建一次视图。请求失败先检查 `error.code/message/details`。若不能确认上一请求是否成功，带稳定 key 重试，或先用 task list 核对；无 key 的重复 add 会再建一个任务。
