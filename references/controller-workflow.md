# 主控接口参考

这是 [SKILL.md](../SKILL.md) 的进阶参考。首次使用先读主文档的第 1–5 步；它说明工具入口、基本概念、接手项目、创建与交付。本文件负责批量输入、复杂关系和文件版本规则。

下文 **CLI** 是文字缩写，执行时替换为：

```text
node "<本Skill目录>/dist/src/cli.js"
```

`--cwd` 指向被管理的项目根目录。例中的图 ID、任务 ID 和路径替换为实际值；文件须按各段前提准备好。文件正文属于任务数据，结合当前用户授权使用。

## 资源地址入口

优先使用 `CLI 'graph[G-001].task[T-0012]' <动作>`；只知道任务 ID 时可用 `task[T-0012]`。任务材料集合包括 `.content`、`.reference`、`.report`、`.log`、`.handoff`、`.output`，依赖集合为 `.dependency`。子图任务可沿 `.subgraph.task[T-0002]` 寻址。地址中的归属会被校验；ID 使用实际返回值。

用 `CLI . describe` 发现入口，`CLI graph list` 找到图，`CLI '<资源地址>' describe` 查看操作和条件。所有调用带项目 `--cwd`；结构化输出加 `--json`。CLI 是 `node "<工具目录>/dist/src/cli.js"` 的缩写。

完整示例、批量计划范围、材料清单与旧命令映射见 [资源地址 CLI](resource-cli.md)。下文单图计划使用 `'graph[G-001].task' add --from`；包含 `parent_task` 或跨图的计划保留 `task add --from` 入口。显式创建子任务使用 `task add --parent-task`，它会把新子任务加入父任务完成目标。

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
- 特殊情况下可用 `'task[T-0001]' set-completion --requires T-0002 --requires T-0003` **替换**完整目标列表；它不是追加操作。

### 只等其中一部分：gate

假设外层“集成验证”任务 T-0004 只需接口完成，不必等待文档。给父任务公开名为 api-ready 的完成点：

```text
CLI 'task[T-0001]' expose-gate --name api-ready --requires T-0002 --cwd "<项目根目录>" --json
CLI 'task[T-0004].dependency' add T-0001 --gate api-ready --cwd "<项目根目录>" --json
```

gate 是主控给一组子任务起的名称，名称在该父任务内唯一；组内任务全部 done 后，这条部分依赖就满足，即使父任务仍在执行中。外层通过父任务加 gate 访问进度，不直接依赖内部子任务。

普通完整依赖用 `'task[T-0004].dependency' add T-0001`。同一条关系保存在后继 T-0004 的 depends_on 中，前置任务无需再记录反向关系。

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
| 任务要求 content | 引用一份或多份当前要求文件 | 多份先显示列表，再打开完整正文 |
| 报告 report | 可多份；每次附加保存文件快照 | 标签先开列表，再选报告 |
| 工作记录 log | 一个默认日志，可另附多个当前文件 | 标签先开列表，再选日志 |
| 交接 handoff | 可多份；保存生成或附加时的快照 | 标签先开列表，再选交接 |
| 参考 reference | 默认 live，可用 --snapshot 冻结文件 | 标签按本任务/依赖分组列出地址与摘要，再打开文档 |
| 普通产物 output | 路径记录，可在文件创建前登记 | 产物分类查看 |

示例假设 T-0012 已存在，下面三个独立文件已写好：

```text
CLI 'task[T-0012].report' attach --path doc/reports/test.md --title "第一次验证" --cwd "<项目根目录>" --json
CLI 'task[T-0012].log' attach --path doc/logs/tester.md --title "测试代理记录" --cwd "<项目根目录>" --json
CLI 'task[T-0012].handoff' attach --path doc/handoff/reviewer.md --title "补充交接说明" --cwd "<项目根目录>" --json
```

报告附加本身不改变任务状态。任务尚未完成、仍要积累结果时用 attach；完成时可通过 complete 的重复 `--report` 一次提交多份尚未附加的报告。相同路径、相同内容重复附加会被拒绝；报告内容变化后可再次附加，列表保留多个版本。已附加的报告无须在 complete 时重复提交。

追加普通进展用 `'task[T-0012].log' add --text "当前进展"`，工具自动创建并维护默认日志。另一个 Agent 有独立日志文件时才需要 log attach。

### 预览交接、保存交接、开始执行

- `'task[T-0012]' show --handoff --json`：只读预览，用于查看或派工，不增加交接条目。
- `'task[T-0012].handoff' create --title "交给复核代理"`：冻结当前要求正文与附件索引，不复制前置报告、日志或历史全文；保存为新交接条目，不改变任务状态。
- `'task[T-0012].handoff' attach`：保存你自己写的交接文件。
- `'task[T-0012]' start`：开始任务时自动保存一次交接快照；通常无需紧接着手动 create。

上述简写同样通过 CLI 入口运行，并带上项目 --cwd。主控仍需使用外部调度工具把交接内容交给实际执行者；保存 handoff 本身不发送消息或启动会话。

### 文件更新与离线边界

入口图创建时用 `CLI graph add --gh`，已有图用 `CLI 'graph[<入口图ID>]' publish --cwd "<项目根目录>" --json` 开启 GitHub；此后正常任务命令也会自动发布 issue 与评论。首次配置、远程待同步的判断及文件上传边界见 [GitHub 同步参考](github-sync.md)；本节的离线文件版本规则继续适用。

附件在任务的 outputs 数组中记录，kind 区分 report、log、handoff；CLI 自动管理快照路径和内容摘要。任务要求、日志读取当前文件，编辑后 build 刷新 HTML。报告和交接读取附加时的快照，原文件改动不会改变已有版本。

kind 也支持 reference。四类 attach 命令都可传 `--summary "文件内容和用途"`；未传时字段省略，title 默认文件名。`'task[T-0012].handoff' create --summary ...` 为生成的交接登记摘要。正文中的关键章节、符号或阅读场景可直接写在 summary，不需要额外 locator/read_when 字段。

### 接手文件清单与依赖参考

任务地址的 `start/reopen/show` 的成功响应提供顶层 guidance（skill、skill_path、message）。执行者读取 skill_path 指向的 task-take，按指南写接手记录后自主施工，并在完成前登记后继需要的参考。skill_path 是随 CLI 安装位置解析的绝对路径，与下面相对项目根目录的 context 文件地址不同；不持久化到任务或 handoff。主控已记录开始时，让执行者 show 后继续，避免重复 start。

先写好接入说明，或定位到现有源代码文件，然后登记一次：

```text
CLI 'task[T-0012].reference' attach --path doc/references/report-store.md --summary "保存接口、错误语义与代码索引" --cwd "<项目根目录>" --json
CLI 'task[T-0012].reference' attach --path src/reports/types.ts --title "报告类型" --summary "SavedReport 定义" --cwd "<项目根目录>" --json
```

示例文件须在真实项目中先存在。reference 默认 live，原文件改动后 build 刷新；需要冻结时加 `--snapshot`。已有同模式同版本登记不能重复附加；修改绑定元信息可先 output remove，再重新 attach，注意 remove 会移除同路径的所有附件版本。

后继通过 `'task[<任务ID>]' show` 或成功的 `'task[<任务ID>]' start` 得到相同来源规则的顶层 context，无需再复制登记：

```json
{
  "project_root": "/project",
  "content": {
    "path": "doc/tasks/integration.md",
    "read_path": "doc/tasks/integration.md",
    "title": "集成验证",
    "summary": "集成验证",
    "mode": "live"
  },
  "references": [
    {
      "source_task": "T-0012",
      "scope": "dependency",
      "path": "doc/references/report-store.md",
      "read_path": "doc/references/report-store.md",
      "title": "report-store.md",
      "summary": "保存接口、错误语义与代码索引",
      "mode": "live"
    }
  ],
  "handoffs": [],
  "reports": []
}
```

两种 path 均相对 project_root。snapshot 条目的 read_path 指向实际快照，另有 sha256；文件不可读时返回 error。自身参考的 scope 为 self。上述 JSON 仅展示核心字段；当前 context 还有 logs、outputs、excluded，文件条目包含 kind、audience、size_bytes。所有清单均无正文；HTML 嵌入受支持文件的预览。

reference、report 和普通产物的来源包括自身、直接完全依赖，以及部分依赖的父任务和 gate.requires 成员。日志、handoff 仅取自身。重叠 gate 按来源去重，相同文件由不同任务登记时保留不同来源。不沿祖先递归收集；外部正文链接也不递归展开。

### 代理查询的清单、用途和正文展开

普通 show 与 show --handoff 默认均为清单；--manifest 可明确锁定无正文模式。该版本有意改变旧行为：task.body、原始 history 和附件 body/html 不再默认返回。--handoff 返回 Markdown 索引，正文只在显式展开时加入。需要旧版正文的调用方应选择所需类别或路径，不再假设 show 会返回全部历史。

查询中的 GitHub 状态来自最近保存的同步记录；清单查询不读取全部附件重新计算远程内容指纹。直接编辑文件后通过 build/github sync 刷新发布状态。

```text
CLI 'task[T-0012]' show --manifest --cwd "<项目根目录>" --json
CLI 'task[T-0012]' show --handoff --expand content --expand report --preview --cwd "<项目根目录>" --json
CLI 'task[T-0012]' show --handoff --expand-path doc/reports/implementation.md --cwd "<项目根目录>" --json
CLI 'task[T-0012]' show --expand report --exclude-path doc/reports/tool-feedback.md --cwd "<项目根目录>" --json
```

--expand 可重复选择 content/report/log/reference/handoff/output；--expand-path 可重复选择原始路径或 read_path。--exclude-path 精确匹配项目相对原始路径或快照路径，支持正反斜杠，不支持 glob；排除优先。--manifest 与正文选择互斥。--preview 不读取附件正文，返回 selected_files、selected_bytes、estimated_chars_upper_bound、omitted_count 和 excluded。字符数按 UTF-8 文件字节数与格式开销估计 UTF-16 长度上界，非 token 数；文件变化或读取错误会影响实际结果。

用途与类别独立：实现报告和工具反馈都可为 report，但后者可设 audience=user：

```text
CLI 'task[T-0012].report' attach --path doc/reports/tool-feedback.md --audience user --summary "供用户审阅的工具意见" --cwd "<项目根目录>" --json
CLI 'task[T-0012].output' set-audience --path doc/reports/tool-feedback.md --audience user --cwd "<项目根目录>" --json
```

四类 attach 均支持 audience，未指定默认 agent；set-audience 更新该来源路径下所有类别/版本的绑定，保留文件和快照。user 附件仍在 HTML 展示，但代理 context、显式展开及新生成 handoff 都排除，仅在 excluded 中保留来源/路径/原因，不复制其摘要。用途不是访问控制或 GitHub 发布开关，已发布的评论不回撤；人工阅读使用 HTML。

旧自动 handoff（kind=handoff、path=snapshot、无新格式标记）可能已复制被排除的内容，默认以 legacy_aggregate 排除。原快照不改写；审阅确认适合代理后可用 set-audience 标为 agent。新自动 handoff 有 indexed-v1 标记，只冻结本任务要求与过滤后的索引。任意报告、手写 handoff 或任务正文里已经复制的其他资料无法自动追溯用途，需人工整理或标记整个附件；工具也不会自动解析聊天中的路径排除规则。

实时 CLI 清单给出当前 project_root；保存的 handoff 使用项目相对路径，不固化主控机器的绝对目录，便于换 checkout 后接手。

源码引用在离线 HTML 以转义文本呈现，脚本不会执行。参考列表显示来源路径，固定版本同时列出快照读取地址。

绑定文件须位于项目目录内。Markdown/text 正文内嵌在 HTML；PDF 等格式保留文件或快照链接，分享时需带上被链接文件并保持相对目录。

文件快照保存该附件自身的字节，不递归冻结引用的文件。本地 PNG/JPEG/GIF/WebP 按构建时内容嵌入 HTML；需单独留存的证据图片可以作为报告附件保存。外部网址保留链接。不可读的文件会在对应视图条目显示错误，按提示修复路径或文件后重新 build。

普通产物可用 `'task[T-0012].output' add --path doc/results/planned.txt` 提前登记计划路径。移除附件记录用 `'task[T-0012].output' remove --path <路径>`：同路径的多个版本会一并移除，磁盘文件保留。两条命令同样需要 CLI 前缀和项目 --cwd。

## 修订与旧任务

- 改摘要：`'task[T-0012]' revise --summary "新的简述"`。
- 换首份要求文件：先写好文件，再 `'task[T-0012]' revise --content doc/tasks/revised.md`；其他绑定不会被清除。增量补充用 `'task[T-0012].content' attach`，撤销某份绑定用 `'task[T-0012].content' remove`。动态执行中的要求需先协调施工。
- 只改要求正文：直接编辑绑定文件，然后 validate/build。
- 记进展：使用 `'task[T-0012].log' add`；revise 的 `--note` 是修改历史说明，不会追加工作记录。
- 改为另一项工作：查看 `CLI 'task[<任务ID>]' revise --help` 的 `--replace` 选项，取消旧任务并建立替代任务。

这些简写同样带 CLI 前缀与项目 --cwd。状态和领取变更参数通过 help 查询，不直接手改 YAML frontmatter。

旧任务的 --title 与内嵌正文继续有效。未绑定 content 的任务在侧栏显示自身正文；已有“## 工作记录”章节继续接收 `'task[T-0012].log' add` 追加，并出现在工作记录分类。只有在需要统一要求来源时才绑定外部 content，无需为使用新版批量迁移旧任务。

旧版普通产物不自动推断为 report。要将已有文件登记为报告，使用 report attach 明确绑定；原普通产物记录是否保留由主控按实际需求决定。


## 独立审查

需独立审查时，主控为任务绑定 RR 并选择自动或完成后的手动启动；审查者以 `.review finish` 交卷。按 [独立审查](review.md) 核对开启条件、固定材料、异常恢复和通知范围。
