# CLI 输出简化实施结果

依据：[输出评估报告](cli-output-audit-2026-09-28.md)。默认只返回本次调用需要的信息，扩展元数据由 `--detail` 获取。

## 已实施

- `show` 保留任务事实、一套 context 文件索引和当前审查摘要；移除默认的重复 documents/outputs/content 别名、完整审查材料和通用教程。
- task list 保留全部匹配任务，移除附件集合；标签 list 仍返回**全部可见文件**，不截断、不只取首份。read_path、摘要、版本类型、依赖来源及读取错误保留。
- start/reopen 保留实际领取身份、完整要求与参考入口、task-take 的 skill_path。
- 附件、日志、产物、依赖、完成点和领取操作返回本次变更；默认不回传历史正文和旧附件集合。
- 审查开关、运行状态、交卷结果分别返回对应信息；失败诊断和恢复入口默认保留。
- watch 注册/取消只确认目标订阅；status 给队列与待处理异常，detail 可查完整状态。
- describe 默认给动作和子资源概览；动作 help 给该动作的语法和条件。
- 新旧语法统一支持 detail；quiet 抑制成功输出，JSON 错误不在 stderr 重复。未知参数明确报错。
- 同步 README、主控接口参考、task-graph、task-take、to-task、to-active-task 文档。

`--detail` 不自动展开正文。`--expand`、`--expand-path`、`--preview` 继续负责正文选择和体量预览。audience 过滤继续生效；默认只返回排除数量。

## 实际项目只读对比

单位为 PowerShell String.Length 等价的 UTF-16 字符数，不是 token。旧采样与本次采样之间项目可能继续变化，因此下表是同一入口的观测对比，不是固定快照基准。没有修改项目任务、启动真实 reviewer 或发送通知。

| 查询 | 修改前 | 修改后 | 减少 |
| --- | ---: | ---: | ---: |
| T-0107 show | 29,852 | 5,887 | 80.3% |
| T-0107 review status | 7,355 | 890 | 87.9% |
| T-0107 auto-review status | 6,712 | 179 | 97.3% |
| G-014 task list | 41,585 | 5,025 | 87.9% |
| G-014 auto-review status | 18,546 | 1,880 | 89.9% |
| T-0107 reference list | 3,452 | 1,747 | 49.4% |
| T-0107 show --handoff | 32,728 | 4,282 | 86.9% |

本身已经简短的 graph show 和无订阅的 watch status 保持原体量。完整测量见 [采样记录](cli-output-simplification-2026-09-28-samples.json)，记录未保存附件正文。

通过已安装 CLI 另行核对：T-0107 reference list 默认与 detail 均返回 6 项，文件数量一致。

## 兼容与验证

默认 JSON 字段有意调整。调用方应读 `context.contents` 等数组，以 `read_path` 读取实际材料；空类别可能省略。依赖旧清单元数据的调用可加 `--detail`。show 的通用 guidance 也改为 detail 返回，正常 start/reopen 仍直接返回 Skill 入口。详见 [输出约定及迁移说明](../../references/cli-output.md)。

隔离测试覆盖多份要求、直接依赖来源、快照、缺失文件、用户专用附件排除、精确展开、写入回执、quiet、错误单次输出、新旧语法、自动审查与单次最终通知。审查状态由本地测试数据驱动，通知使用假适配器；本次未调用真实 reviewer 或真实远端同步。

验证结果：

- TypeScript 构建通过。
- 完整回归：282/282 通过。
- to-task 配套流程：5/5 通过。
- 最后对输出、交接、reference 与接手入口的定向复验：18/18 通过。
- Skill 校验及 git diff --check 通过。

本机安装入口是指向本仓库的 junction，已构建的版本在该入口直接生效。
