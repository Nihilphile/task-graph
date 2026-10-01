# 修订、校验与 HTML

本文的 `CLI` 表示 `node "<工具根目录>/dist/src/cli.js"`；所有调用带目标项目 `--cwd`，结构化输出加 `--json`。入口未确定时读 [准备与定位](bootstrap.md)。

## 修订与旧任务

- 改摘要：`'task[T-0012]' revise --summary "新的简述"`。
- 换首份要求文件：先写好文件，再 `'task[T-0012]' revise --content doc/tasks/revised.md`；其他绑定不会被清除。增量补充用 `'task[T-0012].content' attach`，撤销某份绑定用 `'task[T-0012].content' remove`。动态执行中的要求需先协调施工。
- 只改要求正文：直接编辑绑定文件，然后 validate/build。
- 追加任务日志：使用 `'task[T-0012].log' add`，记录边界见[附件](attachments.md)；revise 的 `--note` 是修改历史说明，不会追加工作记录。
- 改为另一项工作：查看 `CLI 'task[<任务ID>]' revise --help` 的 `--replace` 选项，取消旧任务并建立替代任务。

这些简写同样带 CLI 前缀与项目 --cwd。状态和领取变更参数通过 help 查询，不直接手改 YAML frontmatter。

旧任务的 --title 与内嵌正文继续有效。未绑定 content 的任务在侧栏显示自身正文；已有“## 工作记录”章节继续接收 `'task[T-0012].log' add` 追加，并出现在工作记录分类。只有在需要统一要求来源时才绑定外部 content，无需为使用新版批量迁移旧任务。

旧版普通产物不自动推断为 report。要将已有文件登记为报告，使用 report attach 明确绑定；原普通产物记录是否保留由主控按实际需求决定。

## 校验与构建

结构化字段、状态和关系通过 CLI 修改；要求及 Markdown 正文可直接编辑，之后执行：

```text
CLI . validate --cwd "<项目>" --json
CLI . build --cwd "<项目>" --json
```

成功的结构化修改自动重建 HTML。生成物是 `.task-graph/generated/index.html` 和 graph.json，可重新生成；HTML 只读。readiness/blocked_by 是派生值，不手写回任务。报告与交接快照、GitHub 同步映射应保留。分享 HTML 时，PDF 等链接文件需一同携带并保持目录；文本和支持的图片在构建时嵌入，外部网址保留链接。
