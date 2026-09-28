# Error-book（错题本）

Reviewer 每次 reject 前写一份简短 Markdown 复盘，通过 `--error-report <项目相对路径>` 和本轮验收结果一起提交。普通 `reject`、`complete --result reject` 和独立审查 `.review finish --result reject` 均要求这个参数；缺失、空文件或文件不可读时整次操作失败，任务状态和领取保持原样。

小报告采用自由文本，建议三小段即可：

```markdown
# 空输入导致导出失败

失败：空结果集导出抛异常，未满足验收条件 2；证据见本轮验收报告。

失败模式：遗漏边界条件。

分析与改进：只验证了有数据的路径；修复后增加空结果集用例，并将其加入交付自查。
```

由 reviewer 基于本轮证据分析。原因尚未确定时写明待确认项及下一步验证方式。无需固定分类、标签或统计次数。

```text
CLI 'task[T-0001]' reject --report reports/review.md --error-report reports/error.md --cwd "<项目根目录>" --json
CLI 'task[T-0001].review' finish --review-id <本轮UUID> --result reject --report reports/review.md --error-report reports/error.md --cwd "<项目根目录>" --json
CLI 'graph[G-001].errorbook' show --cwd "<项目根目录>" --json
CLI errorbook list --cwd "<项目根目录>" --json
```

本轮验收报告已有简短复盘时，两个参数可以指向同一文件。小报告和验收报告都保存快照；每次成功 reject 追加一条记录，复验通过、重用文件名或重建 HTML 均保留旧记录。普通重复提交已 reject 的任务会失败；再次验收须显式 reopen。独立审查同一轮次、相同结果及两份报告的重复 finish 幂等，不追加记录；旧轮次回写会被拒绝。blocked 和审查进程异常不会写入错题本。

HTML 每张图都有独立 error-book 方块，点击后按时间显示当前图及其子图的小报告，可跳回对应任务。它不参与任务依赖、领取或完成目标。CLI 的 `errorbook` 查看整个项目，`graph[<ID>].errorbook` 查看该图及子图；`list` 返回文件索引，`show` 展开小报告正文。

记录来源保存在任务的 rejection history，Markdown 快照保存在 `.task-graph/snapshots/`。备份时保留整个 `.task-graph/`。旧版已有 reject 缺少小报告时维持原历史，不自动编造或补写分析。工具校验文件格式与可读性，分析质量由 reviewer 负责。此版本的 error-book 仅在本地 CLI 与 HTML 展示。
