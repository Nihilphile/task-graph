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

`describe` 列出操作、子地址、用法和条件；实例存在时还返回当前状态、领取和阻塞。不存在的对象仍可查询类型说明，不会初始化或写入项目。类型支持某动作不表示当前状态允许执行，也不表示已取得业务授权；执行时仍检查全部条件。`<地址> --help` 等价于 describe，`<地址> <动作> --help` 查看该动作。

## 常用地址与动作

| 地址 | 动作 |
| --- | --- |
| `.` | init、validate、build、describe |
| `graph` | add、list、describe |
| `graph[G-001]` | show、publish、watch、unwatch、describe |
| `graph[G-001].task` | add、list、describe |
| `graph[G-001].task[T-0012]` | show、revise、refine、unrefine、start、complete、reject、cancel、reopen、claim、release、reassign、link、unlink、block、unblock、attach-subgraph、set-completion、expose-gate、describe |
| `…task[T-0012].content` | list、attach、remove、describe |
| `…task[T-0012].reference` / `.report` | list、attach、describe |
| `…task[T-0012].log` | list、add、attach、describe |
| `…task[T-0012].handoff` | list、attach、create、describe |
| `…task[T-0012].output` | list、add、remove、set-audience、describe |
| `…task[T-0012].dependency` | list、add、remove、describe |
| `…task[T-0012].subgraph` | show、describe |
| `…task[T-0012].subgraph.task` | add、list、describe |
| `graph[G-001].watch` | add、remove、status、flush、retry、describe |

表中的省略号代表完整图地址。附件集合当前按文件路径绑定、移除，通过 list 返回的 `read_path` 读取；未引入 `.report[序号]`。`task list` 保留为跨图查询，`task add --from` 保留为跨图批量创建入口。`source add`、`github sync`、`skill validate` 保持原语法，也支持对应集合的 describe。

## 创建、细化与执行

```text
CLI 'graph[G-001].task' add --summary "实现存档" --content docs/tasks/goal.md --planning dynamic --depends-on T-0010 --depends-on T-0011 --cwd "<项目>" --json
CLI 'graph[G-001].task' list --needs-refinement --cwd "<项目>" --json
CLI 'graph[G-001].task[T-0012].content' attach --path docs/tasks/details.md --summary "接口与验收入口" --cwd "<项目>" --json
CLI 'graph[G-001].task[T-0012]' refine --reason "要求与前置接口已核实" --cwd "<项目>" --json
CLI 'graph[G-001].task[T-0012]' start --role worker --session-id ACTUAL_SESSION --cwd "<项目>" --json
CLI 'graph[G-001].task[T-0012].log' add "已确认上下文，开始施工" --cwd "<项目>" --json
```

例中的 ID 换成实际返回值。新地址命令返回的任务对象包含 `resource`，可直接传给下一次调用；项目入口使用 `graph list` 发现图。`start/show` 保留 context 与 task-take 指引。动态任务、快照、领取和验收的语义与旧命令相同。

图内批量创建：

```text
CLI 'graph[G-001].task' add --from "<计划JSON绝对路径>" --cwd "<项目>" --json
```

该集合中的任务必须属于 G-001；计划中指向其他图或使用 parent_task 时整批拒绝。跨图计划、包含父子拆分的计划使用 `CLI task add --from ...`，按原计划字段表达归属。已有子图的集合 `graph[G-001].task[T-0012].subgraph.task add` 可以在子图中创建任务，但不会自动把新任务加入父任务的 `completion_requires`。单个子任务使用 `CLI task add --parent-task T-0012 ...` 会创建或复用子图，并默认把新任务加入父任务完成目标；从返回值取得新任务所在图，再用完整地址操作。已有任务的 `.subgraph show` 返回子图地址。

`--from` 路径按调用目录解析，建议用绝对路径；content、附件路径按项目根目录解析。依赖数组、@key 与稳定 key 的重试规则见 [主控接口参考](controller-workflow.md)。

## 依赖与材料

```text
CLI 'graph[G-001].task[T-0012].dependency' list --cwd "<项目>" --json
CLI 'graph[G-001].task[T-0012].dependency' add T-0011 --cwd "<项目>" --json
CLI 'graph[G-001].task[T-0012].dependency' remove T-0011 --cwd "<项目>" --json
CLI 'graph[G-001].task[T-0012].reference' list --cwd "<项目>" --json
CLI 'graph[G-001].task[T-0012].reference' attach --path docs/reference/api.md --summary "实际接口与调用示例" --cwd "<项目>" --json
CLI 'graph[G-001].task[T-0012].report' attach --path docs/reports/test.md --summary "验证结果" --cwd "<项目>" --json
```

已有依赖每次 add/remove 一条，创建任务可重复 `--depends-on`。依赖参数接受项目内唯一 task ID，也接受完整地址 `graph[G-002].task[T-0018]`；完整地址会额外校验图归属。跨图仍受原有图边界、完成点和循环校验约束。创建时可附 `:gate`，依赖编辑也可用 `--gate`。

附件 list 复用 agent context 的过滤和来源规则：reference/report 可包括直接依赖的材料，`scope`、`source_task`、`source_resource` 标明来源；content 是本任务的全部要求。响应保留 summary、live/snapshot、read_path 和 project_root，默认没有正文。user 附件与旧版未审核聚合交接保持排除；HTML 中仍可供人阅读。按需展开正文使用任务 show 的 `--expand-path`、`--expand`、`--preview`。

## 通知

```text
CLI 'graph[G-001].watch' add --thread UUID --cwd "<项目>" --json
CLI 'graph[G-001].watch' status --cwd "<项目>" --json
CLI 'graph[G-001].watch' flush --cwd "<项目>" --json
CLI 'graph[G-001].watch' remove --thread UUID --cwd "<项目>" --json
CLI 'graph[G-001].watch' retry EVENT_ID --allow-duplicate --cwd "<项目>" --json
```

add 需要主控显式注册实际 Desktop UUID；status 只读。恢复投递和不确定结果的限制见 [动态工作流参考](dynamic-workflow.md)。

## 兼容

旧命令如 `task show T-0012`、`task report attach T-0012` 继续支持，原 JSON 形状保留。新地址作为入口路由到同一语义处理，不迁移任务数据、不改变完成条件。后续 skill 示例优先使用资源地址；历史报告中的旧命令仍然可执行。
