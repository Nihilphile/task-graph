# 复杂关系与恢复

下文 CLI 代表 `node "<task-graph工具根>/dist/src/cli.js"`，所有调用带目标项目 `--cwd`；地址和参数可用 `CLI '<地址>' describe` 查询，规则见 [资源地址 CLI](../../../references/resource-cli.md)。`--from` 建议传绝对路径，content 与附件路径相对项目根目录。

## 给现有任务拆子图

先查询父任务。它应代表最终交付或统筹验收；done 父任务在确实要继续工作时先 reopen，cancelled 任务应使用替代任务。

各子任务写 `parent_task`，省略它们自己的 `graph`，再批量 add。父任务未有子图时工具自动创建，以后复用；新增子任务默认加入父任务的完成目标。

```json
{
  "tasks": [
    {
      "key": "delivery.base",
      "summary": "完成最小交付路径",
      "content": "doc/tasks/delivery/base.md",
      "parent_task": "T-0042",
      "depends_on": []
    },
    {
      "key": "delivery.boundary",
      "summary": "补齐边界行为",
      "content": "doc/tasks/delivery/boundary.md",
      "parent_task": "T-0042",
      "depends_on": ["@delivery.base"]
    }
  ]
}
```

这里 T-0042 是示例，替换为查询得到的实际父任务 ID。用 `CLI task add --from "<计划绝对路径>" --cwd "<项目根目录>" --json` 提交；不需要 `--graph`，parent_task 决定位置。子任务不依赖自己的父任务完成，否则会把执行顺序倒置。

## 同批父子与局部完成点

同批新父任务用 `key` 标识，子任务使用 `"parent_task": "@delivery.parent"`。用 `CLI task add --from "<计划绝对路径>" --graph <入口图ID> --cwd "<项目根目录>" --json` 提交；父任务所属入口图由计划顶层 `graph` 或 CLI `--graph` 提供。含 parent_task 的计划不能提交给 `graph[G-001].task add --from`。

当外层任务只需父任务的一部分时，父任务的计划字段可写：

```json
"exposes": { "base-ready": { "requires": ["@delivery.base"] } }
```

外层任务使用 `"depends_on": ["@delivery.parent:base-ready"]`。各 requires 是该父任务直接子图内的任务；外层不直接依赖内部子任务。无需局部放行时，直接依赖父任务完成即可。

需要自定义父任务完成范围时，`completion_requires` 是完整目标数组，会替换默认范围。通常保留工具默认的全部新增子任务；排除某项时写清它为什么不属于父任务完成条件。

## 重试、续补与修订

- **同批重试**：相同稳定 key 和相同创建参数返回原 ID。保留原计划、传入同一图，并保存返回映射；task-graph 的 key 在项目范围唯一。
- **图创建后中断**：先读 project.yaml 和计划目录中的已有回执，核对 title、现有 task 内容及 key；不能确定哪个图属于此次工作时询问，避免再次 graph add。
- **原内容修订**：编辑已绑定 content，随后 `CLI . build --cwd "<项目根目录>" --json`；改摘要或更换 content 路径用 `'task[<任务ID>]' revise`。相同 key 改变原始创建参数会得到 E_KEY_CONFLICT，不通过换 key 绕过修订。
- **追加工作**：为新范围分配新 key，写增量计划。依赖既有任务时使用它的 T-ID，或已确认存在的 @key。
- **关系调整**：使用 `'task[<后继ID>].dependency' add/remove`、`'task[<父任务ID>]' expose-gate/set-completion`；回查受影响任务的就绪状态。历史 plan.json 是创建请求，当前关系以任务源文件和查询为准。
- **远程 pending**：本地任务已经保存。使用 `CLI github sync --cwd "<项目根目录>" --json` 补发；保留 `.task-graph/github-sync.json`。报告和交接的快照与远程历史不会因移除本地附件记录而删除。

需求文件只需保留一份权威正文。原始 PRD/spec 可以在各 content 中引用；如果项目需要结构化溯源，先 `CLI source add` 登记真实来源，再使用 derived_from。单纯建任务无需为了字段完整而额外注册来源。
