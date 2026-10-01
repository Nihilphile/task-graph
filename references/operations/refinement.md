# 动态细化与撤回

本文的 `CLI` 表示 `node "<工具根目录>/dist/src/cli.js"`；所有调用带目标项目 `--cwd`，结构化输出加 `--json`。入口未确定时读 [准备与定位](bootstrap.md)。

## 骨架与放行

创建时 `--planning dynamic`；批量 JSON 使用 `planning: "dynamic"`。子任务逐个显式指定，不继承父任务模式。

| planningState | 含义 |
| --- | --- |
| static | 原静态任务流程 |
| skeleton | 动态骨架，尚有依赖或人工阻塞 |
| awaiting_review | 其他阻塞已解除，等待主控判断 |
| refined | 主控已放行，未显式撤回；仍须满足依赖 |

`CLI task list --needs-refinement --cwd "<项目根目录>" --json` 返回 todo/reject、未领取且只剩细化门槛的任务。`CLI 'task[T-0001]' refine --reason "评估依据" [--actor "主控"] --cwd "<项目根目录>" --json` 在依赖/人工阻塞消除后保存放行；同一地址的 `unrefine --reason "原因"` 撤销未执行任务的放行。允许未领取的 todo/reject，以及明确准备返工的 done；禁止对执行中任务操作。

本版暂停放行指纹的生成与校验，默认放行后没有未协调的实质变化；旧指纹保留可读但不参与判断，不再产生 stale。发现需要重评时由主控 unrefine。因漏掉中途变化导致实际返工或额外步骤时，按[错题本](../error-book.md)记一次。

start/claim/reassign 仍检查放行和依赖。执行中通过 CLI 修改要求绑定、依赖、标题或正文仍须先协调；替代任务须重新 refine。外部文件变化不再自动撤销放行，执行者发现冲突按 task-take 通知主控。审查及测试输入的版本校验不受此调整影响。

多份要求的增补/移除见 [绑定材料](attachments.md)。判断何时推进或探索见 [动态规划思想](../workflows/dynamic-planning.md)。
