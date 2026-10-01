# 资源地址 CLI

使用 `task-graph '<资源地址>' <动作> [参数]`。本文的 `CLI` 代表 `node "<工具目录>/dist/src/cli.js"`；每次调用用 `--cwd` 指定项目，结构化输出加 `--json`。

## 寻址与发现

`graph[G-001].task[T-0012]` 表示 G-001 中的 T-0012。点号进入所属部分，方括号选择成员：`.task` 是任务集合，`.task[T-0012]` 是具体任务。这是工具的地址表达式，不是文件路径或可执行代码。

地址中的图归属会校验。任务属于其他图时返回错误与正确地址，不会操作那个任务。图和任务仍使用原来的项目内唯一 ID；文件存储格式不变。PowerShell 7 可以直接传这些地址；示例统一加单引号，以兼容会对方括号做文件名匹配的 shell。

支持沿任务的子图继续寻址：

```text
CLI 'graph[G-001].task[T-0001].subgraph.task' list --cwd "<项目>" --json
CLI 'graph[G-001].task[T-0001].subgraph.task[T-0002]' show --cwd "<项目>" --json
CLI 'task[T-0001].subgraph.task[T-0002].report' list --cwd "<项目>" --json
```

task ID 在项目内唯一，因此 `task[T-0001]` 可作为起点简写。`.subgraph.task` 访问已有子图中的任务集合，后面可以继续重复 `.subgraph.task[ID]`。每一层都会校验归属；缺少子图时操作失败，describe 可说明缺失原因。读取和向集合 add 都不会隐式创建子图。需要创建子图时显式使用 `task add --parent-task` 或 `graph add --parent-task`。

返回的任务 `resource` 统一使用直接的 `graph[实际所属图].task[ID]` 地址，避免调用方必须记住完整祖先链。自定义 graph ID 也支持；返回地址对特殊字符进行百分号编码，直接复用即可。

```text
CLI . describe --cwd "<项目>" --json
CLI graph list --cwd "<项目>" --json
CLI 'graph[G-001]' show --cwd "<项目>" --json
CLI 'graph[G-001].task[T-0012]' describe --cwd "<项目>" --json
CLI 'graph[G-001].task[T-0012]' start --help --json
```

`describe` 默认列出操作名、简述和子资源名；`describe --detail` 增加用法、条件及当前状态、领取和阻塞。不存在的对象仍可查询类型说明，不会初始化或写入项目。类型支持某动作不表示当前状态允许执行，也不表示已取得业务授权；执行时仍检查全部条件。`<地址> --help` 等价于 describe，`<地址> <动作> --help` 查看该动作。

`task list --readiness unready` 筛选前置依赖或细化门槛未满足的任务；`--status blocked` 筛选执行受阻。blocked 本身不禁止 start，成功接手后进入 in_progress，详情见 [受阻与动态工作流](dynamic-workflow.md#显式受阻状态)。

## 常用地址与动作

| 地址 | 动作 |
| --- | --- |
| `.` | init、validate、build、describe |
| `graph` | add、list、describe |
| `graph[G-001]` | show、publish、watch、unwatch、describe |
| `graph[G-001].task` | add、list、describe |
| `graph[G-001].task[T-0012]` | show、revise、refine、unrefine、start、complete、reject、cancel、reopen、claim、release、reassign、link、unlink、block、unblock、attach-subgraph、set-completion、expose-gate、describe |
| `…task[T-0012].content` | list、attach、remove、describe |
| `…task[T-0012].review-requirement` | list、attach、remove、describe |
| `…task[T-0012].reference` | add、attach、remove、list、describe（代码条目） |
| `…task[T-0012].contract` | attach、remove、list、describe |
| `contract` / `contract[C-0001]` | add/list；show/update/describe |
| `contract[C-0001].reference` | add、attach、remove、list、describe |
| `reference` / `reference[R-0001]` | add/list；show/update/describe |
| `decision` | record、describe |
| `…task[T-0012].report` | list、attach、describe |
| `…task[T-0012].log` | list、add、attach、describe |
| `…task[T-0012].handoff` | list、attach、create、describe |
| `…task[T-0012].output` | list、add、remove、set-audience、describe |
| `…task[T-0012].dependency` | list、add、remove、describe |
| `…task[T-0012].subgraph` | show、describe |
| `…task[T-0012].subgraph.task` | add、list、describe |
| `graph[G-001].watch` | add、remove、status、flush、retry、describe |
| `…task[T-0012].auto-review` | enable、disable、status、describe |
| `…task[T-0012].review` | configure、start、finish、restart、status、recover、describe |
| `graph[G-001].auto-review` | enable、status、describe |

表中的省略号代表完整图地址。附件集合当前按文件路径绑定、移除，通过 list 返回的 `read_path` 读取；未引入 `.report[序号]`。`task list` 保留为跨图查询，`task add --from` 保留为跨图批量创建入口。`source add`、`github sync`、`skill validate` 保持原语法，也支持对应集合的 describe。

## 按动作查操作手册

- 创建/批量计划：[创建计划](operations/planning.md)。
- 父子与依赖：[子图和完成点](operations/relationships.md)。
- 开始/领取/受阻：[执行操作](operations/execution.md)。
- 材料绑定：[附件](operations/attachments.md)；读取结果：[上下文](operations/context.md)。
- 提交交付：[交付](operations/delivery.md)；审查配置：[审查控制](operations/review-control.md)。
- Desktop 通知：[订阅](operations/watch.md)。

## 兼容

旧命令如 task show T-0012、task report attach T-0012 继续支持，并与资源地址使用相同处理逻辑。当前默认输出契约见 [CLI 输出](cli-output.md)，需扩展元数据时加 --detail。完整旧命令目录供维护者按需查询：[commands.md](commands.md)。
