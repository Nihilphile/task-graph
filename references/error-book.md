# Error-book（错题本）

错题本接收验收失败及实际发生的返工。reject 按[普通验收任务](operations/acceptance.md)或[独立审查](operations/review-submit.md)提交 `--error-report <项目相对路径>`。

暂停放行指纹后，因中途修改未被察觉而返工或增加步骤，每次记录一条：什么变了、旧认知导致什么问题、额外工作及相关[交付标识](operations/delivery.md)；原因不确定时注明。可复用报告，不另造统计系统。未发生此类损失时不记录。

```text
CLI 'task[T-0042]' record-error --error-report <项目相对报告.md> --cwd "<项目>" --json
```

record-error 保存报告快照，不改变状态、领取或依赖，已完成任务也可记录；同一事件已随 reject 保存则不重复记。每次成功调用新增一条，回执不确定时先查 errorbook 再重试。缺失、空白、非 Markdown 或不可读报告均失败且不改变原状态。

小报告采用自由文本，建议三小段即可：

```markdown
# 空输入导致导出失败

失败：空结果集导出抛异常，未满足验收条件 2；证据见本轮验收报告。

失败模式：遗漏边界条件。

分析与改进：只验证了有数据的路径；修复后增加空结果集用例，并将其加入交付自查。
```

由记录者基于实际证据分析，原因未定时注明；无需固定分类或标签。

本轮验收报告已有复盘时，两参数可指向同一文件。每次成功 reject 追加一条快照，复验通过或重建保留历史；普通复验须 reopen。独立审查同轮同结果与报告的 finish 幂等，旧轮次回写被拒绝。blocked 和进程异常本身不自动记错。

HTML 每张图都有独立 error-book 方块，点击后按时间显示当前图及其子图的小报告，可跳回对应任务。它不参与任务依赖、领取或完成目标。CLI 的 `errorbook` 查看整个项目，`graph[<ID>].errorbook` 查看该图及子图；`list` 返回文件索引，`show` 展开小报告正文。

来源为任务的 rejected / error_recorded history，快照在 `.task-graph/snapshots/`；备份保留整个 `.task-graph/`。旧 reject 缺少小报告时不补造。错题本仅在本地 CLI 与 HTML 展示。
