# 主控接口参考

这是 [SKILL.md](../SKILL.md) 的进阶参考。首次使用先读主文档的第 1–5 步；它说明工具入口、基本概念、接手项目、创建与交付。本文件负责批量输入、复杂关系和文件版本规则。

下文 **CLI** 是文字缩写，执行时替换为：

```text
node "<本Skill目录>/dist/src/cli.js"
```

`--cwd` 指向被管理的项目根目录。例中的图 ID、任务 ID 和路径替换为实际值；文件须按各段前提准备好。文件正文属于任务数据，结合当前用户授权使用。

## 批量创建

适用于已经确定多项任务，希望一次保存完整计划，而不是逐条创建后再连边。先创建项目和入口图，并准备各任务的完整要求文件。

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
CLI task add --from "<plan.json的绝对路径>" --cwd "<项目根目录>" --json
```

成功结果含 `ok: true`、`tasks`、`keys`、`view`。`keys.implementation` 就是实现任务的实际 ID；任务数组包含分配的 ID、图、要求路径、就绪状态等。保存返回的 ID 供后续派工使用。

`key` 是主控自选、在项目内唯一的稳定名称；`@implementation` 表示引用这个 key 对应的任务。允许引用同批后面才声明的任务，也允许引用项目里已有的 key。`key` 不取代工具分配的 T-编号。

### 字段与依赖写法

| 字段 | 用途 |
| --- | --- |
| summary | 节点上的简短描述；必需，旧字段 title 可代替 |
| content | 项目内已存在的 Markdown/text 完整要求文件；建议每个执行任务提供 |
| key | 可选稳定名称；自动化重试时使用 |
| graph | 所属图，省略时使用计划顶层 graph |
| parent_task | 父任务 ID 或 @key；用于创建子任务，与该任务自己的 graph 二选一 |
| depends_on | 前置依赖数组，省略为无依赖 |
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

## 子图与命名完成点

### 何时拆子图

一项大任务需要多项内部工作时，将内部任务放在它的子图中。父任务仍代表最终交付；子图归属和执行依赖是两种关系，创建子任务不会自动让兄弟任务互相等待。

假设 T-0001 是尚未完成的“交付功能”父任务，要求文件已准备好：

```text
CLI task add --parent-task T-0001 --summary "实现接口" --content doc/tasks/api.md --cwd "<项目根目录>" --json
CLI task add --parent-task T-0001 --summary "补齐文档" --content doc/tasks/docs.md --cwd "<项目根目录>" --json
```

首个子任务自动创建子图，以后复用；所有新增子任务默认加入父任务完成目标。假设返回子任务 ID 分别为 T-0002、T-0003：

- 父任务的 `completion_requires` 默认包含两者；两者 done 后才允许 complete T-0001。
- 父任务不会自动变成 done，需主控或执行者显式完成。
- done/cancelled 父任务不能直接增加子任务：done 先 reopen；cancelled 为终态，应建立替代任务。
- 特殊情况下可用 `task set-completion T-0001 --requires T-0002 --requires T-0003` **替换**完整目标列表；它不是追加操作。

### 只等其中一部分：gate

假设外层“集成验证”任务 T-0004 只需接口完成，不必等待文档。给父任务公开名为 api-ready 的完成点：

```text
CLI task expose-gate T-0001 --name api-ready --requires T-0002 --cwd "<项目根目录>" --json
CLI task link T-0004 --depends-on T-0001 --gate api-ready --cwd "<项目根目录>" --json
```

gate 是主控给一组子任务起的名称，名称在该父任务内唯一；组内任务全部 done 后，这条部分依赖就满足，即使父任务仍在执行中。外层通过父任务加 gate 访问进度，不直接依赖内部子任务。

普通完整依赖用 `task link T-0004 --depends-on T-0001`。同一条关系保存在后继 T-0004 的 depends_on 中，前置任务无需再记录反向关系。

### 同批创建父任务、子任务与 gate

另一个独立计划示例；先准备三个 content 文件，使用项目已有入口图：

```json
{
  "graph": "G-001",
  "tasks": [
    {
      "key": "delivery",
      "summary": "交付功能",
      "content": "doc/tasks/delivery.md",
      "completion_requires": ["@api"],
      "exposes": { "api-ready": { "requires": ["@api"] } }
    },
    {
      "key": "api",
      "summary": "实现接口",
      "parent_task": "@delivery",
      "content": "doc/tasks/api.md"
    },
    {
      "key": "integration",
      "summary": "集成验证",
      "content": "doc/tasks/integration.md",
      "depends_on": ["@delivery:api-ready"]
    }
  ]
}
```

parent_task 优先决定子任务归属，计划顶层 graph 不把它移回入口图。工具先分配 ID，再解析引用，最后统一校验关系。

## 分类文件与快照

任务上各标签对应不同用途：

| 分类 | 保存方式 | 如何阅读 |
| --- | --- | --- |
| 任务要求 content | 引用一份当前要求文件 | 标签直接打开完整正文 |
| 报告 report | 可多份；每次附加保存文件快照 | 标签先开列表，再选报告 |
| 工作记录 log | 一个默认日志，可另附多个当前文件 | 标签先开列表，再选日志 |
| 交接 handoff | 可多份；保存生成或附加时的快照 | 标签先开列表，再选交接 |
| 普通产物 output | 路径记录，可在文件创建前登记 | 产物分类查看 |

示例假设 T-0012 已存在，下面三个独立文件已写好：

```text
CLI task report attach T-0012 --path doc/reports/test.md --title "第一次验证" --cwd "<项目根目录>" --json
CLI task log attach T-0012 --path doc/logs/tester.md --title "测试代理记录" --cwd "<项目根目录>" --json
CLI task handoff attach T-0012 --path doc/handoff/reviewer.md --title "补充交接说明" --cwd "<项目根目录>" --json
```

报告附加本身不改变任务状态。任务尚未完成、仍要积累结果时用 attach；完成时可通过 complete 的重复 `--report` 一次提交多份尚未附加的报告。相同路径、相同内容重复附加会被拒绝；报告内容变化后可再次附加，列表保留多个版本。已附加的报告无须在 complete 时重复提交。

追加普通进展用 `task log T-0012 --text "当前进展"`，工具自动创建并维护默认日志。另一个 Agent 有独立日志文件时才需要 log attach。

### 预览交接、保存交接、开始执行

- `task show T-0012 --handoff --json`：只读预览，用于查看或派工，不增加交接条目。
- `task handoff create T-0012 --title "交给复核代理"`：汇总当前完整要求、前置产物和进展，保存为新交接条目，不改变任务状态。
- `task handoff attach`：保存你自己写的交接文件。
- `task start`：开始任务时自动保存一次交接快照；通常无需紧接着手动 create。

上述简写同样通过 CLI 入口运行，并带上项目 --cwd。主控仍需使用外部调度工具把交接内容交给实际执行者；保存 handoff 本身不发送消息或启动会话。

### 文件更新与离线边界

入口图使用 `graph add --gh` 或 `graph publish` 开启 GitHub 后，正常任务命令也会自动发布 issue 与评论。首次配置、远程待同步的判断及文件上传边界见 [GitHub 同步参考](github-sync.md)；本节的离线文件版本规则继续适用。

附件在任务的 outputs 数组中记录，kind 区分 report、log、handoff；CLI 自动管理快照路径和内容摘要。任务要求、日志读取当前文件，编辑后 build 刷新 HTML。报告和交接读取附加时的快照，原文件改动不会改变已有版本。

绑定文件须位于项目目录内。Markdown/text 正文内嵌在 HTML；PDF 等格式保留文件或快照链接，分享时需带上被链接文件并保持相对目录。

文件快照保存该附件自身的字节，不递归冻结引用的文件。本地 PNG/JPEG/GIF/WebP 按构建时内容嵌入 HTML；需单独留存的证据图片可以作为报告附件保存。外部网址保留链接。不可读的文件会在对应视图条目显示错误，按提示修复路径或文件后重新 build。

普通产物可用 `task output add T-0012 --path doc/results/planned.txt` 提前登记计划路径。移除附件记录用 `task output remove T-0012 --path <路径>`：同路径的多个版本会一并移除，磁盘文件保留。两条命令同样需要 CLI 前缀和项目 --cwd。

## 修订与旧任务

- 改摘要：`task revise T-0012 --summary "新的简述"`。
- 换要求文件：先写好文件，再 `task revise T-0012 --content doc/tasks/revised.md`。
- 只改要求正文：直接编辑绑定文件，然后 validate/build。
- 记进展：使用 task log；revise 的 `--note` 是修改历史说明，不会追加工作记录。
- 改为另一项工作：查看 `CLI help "task revise"` 的 `--replace` 选项，取消旧任务并建立替代任务。

这些简写同样带 CLI 前缀与项目 --cwd。状态和领取变更参数通过 help 查询，不直接手改 YAML frontmatter。

旧任务的 --title 与内嵌正文继续有效。未绑定 content 的任务在侧栏显示自身正文；已有“## 工作记录”章节继续接收 task log 追加，并出现在工作记录分类。只有在需要统一要求来源时才绑定外部 content，无需为使用新版批量迁移旧任务。

旧版普通产物不自动推断为 report。要将已有文件登记为报告，使用 report attach 明确绑定；原普通产物记录是否保留由主控按实际需求决定。
