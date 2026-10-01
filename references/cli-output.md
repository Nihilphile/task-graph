# CLI 输出约定

默认输出回答本次动作的问题。`--detail` 增加相关元数据、来源和诊断；正文仍需明确选择。资源式和旧式语法都支持 `--detail`。

## 查询什么，返回什么

| 调用 | 默认结果 | `--detail` 增加 |
| --- | --- | --- |
| `'task[T-0001]' show` | 任务事实、状态、依赖、阻塞、当前 review 摘要和一套 `context` | 完整元数据、配置、旧版清单字段、guidance |
| `'graph[G-001].task' list` | 全部匹配任务的状态、就绪、实际领取与阻塞 | 附件元数据和审计字段 |
| `'task[T-0001].report' list` | **全部可见文件**的读取路径、摘要、版本类型和依赖来源 | 指纹、大小、完整来源和排除原因 |
| `start/reopen` | 实际状态和领取、context、`guidance.skill_path` | 完整接手指南和清单元数据 |
| `attach/log add/output add` | 本次新增项的入口；日志返回记录位置 | 相关附件元数据 |
| `.auto-review status` | 是否启用、是否显式关闭 | 配置和完整 review 视图 |
| `.review status` | 当前轮次、运行状态、会话、结果或错误与恢复提示 | 冻结材料、进程信息及历史轮次 |
| `.review finish` | 任务最终状态、审查结果及报告入口 | 完整 review 视图 |
| `.watch add/remove` | 注册/取消的 graph、thread 和状态 | 完整订阅状态 |
| `.watch status` | 订阅、队列统计和待处理异常 | 投递历史与诊断 |
| `describe` | 是否存在、动作名和简述、子资源名 | 完整语法、条件、状态 |

标签集合使用 `list`，不是 `show`；例如 `.content list`、`.reference list`、`.review-requirement list`。任务详情使用任务地址的 `show`。文件清单不因精简而截断、抽样或只返回第一份。

## 怎样读取文件

```text
CLI 'task[T-0001].reference' list --cwd "<项目>" --json
CLI 'task[T-0001]' show --cwd "<项目>" --json
CLI 'task[T-0001]' show --detail --cwd "<项目>" --json
CLI 'task[T-0001]' show --expand-path docs/tasks/implementation.md --cwd "<项目>" --json
```

`CLI` 代表 `node "<工具目录>/dist/src/cli.js"`。

- 文件的 `read_path` 相对 `project_root`；快照应读该路径，不能改读来源文件。
- `path` 只在来源与读取路径不同时返回。`summary` 有值就展示，否则使用标题。`mode` 标明 live 或 snapshot。
- 依赖提供的材料保留 `source_task`；同一文件来自不同任务时保留各自条目。自身材料不重复标自身来源。
- `context.contents` 是任务要求，`contracts` 是当前契约，`code_references` 是去重后的代码入口条目，`review_requirements` 是验收要求；其余按旧 references/reports/logs/handoffs/outputs 分类。空类别可以省略，调用方用 `context.references ?? []` 等方式读取。
- 文件不可读时保留条目及 `error`。阻塞、审查失败、通知未确认等信息默认可见。

`--detail` 不自动读取附件正文，也不越过 audience 排除。正文用 `show --expand <类别>` 或 `--expand-path <路径>`；体量预览用 `--preview`。显式读取正文的 `.errorbook show` 保持正文语义。

`--handoff` 把选定信息排成 Markdown；默认 JSON 返回 `handoff` 和项目根目录，不再同时返回镜像 context。用户专用附件和旧版聚合交接默认只计入 `excluded_count`；`--detail` 可查看排除路径和原因，仍不展开其正文。

## 调用方迁移

默认 show 不再有 `task.documents`、`task.outputs`、`context.content` 和通用 guidance。读取材料统一使用 `context` 中的数组。确需旧字段时加 `--detail`；该选项用于兼容与诊断，不建议作为每次调用的默认参数。

主控已 start 的任务可以直接 show 恢复材料；若执行者尚未拿到 task-take 入口，用一次 `show --detail` 获取 `guidance.skill_path`。正常 start/reopen 仍直接返回入口。

查询不改任务。普通成功回执不再回显旧附件或历史正文；`--quiet` 隐藏成功输出，失败保留。`--json` 的结构化错误只输出一次，不在 stderr 重复同一错误；独立的运行警告仍可出现在 stderr。未知参数会报错。

contract/reference 条目及 decision 写入返回 `saved` 和 `view.status`；页面失败不否定状态已保存。`.contract list` / `.reference list` 返回 `entries`，条目包含 ID 和定位信息；旧文件参考仍返回 `files`，其他文件集合也使用 `files`。
