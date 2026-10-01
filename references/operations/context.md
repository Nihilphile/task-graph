# 读取任务上下文

本文的 `CLI` 表示 `node "<工具根目录>/dist/src/cli.js"`；所有调用带目标项目 `--cwd`，结构化输出加 `--json`。入口未确定时读 [准备与定位](bootstrap.md)。

普通执行者读取 start/show 的当前 context；contracts 是绑定的权威契约，code_references 是最多 30 字说明的代码入口条目，不自动展开源码。旧 references 保留文件式历史接口；新登记见[契约与条目](contracts.md)。独立 reviewer 读取本轮提示词给出的冻结清单，见 [审查交卷](review-submit.md)。

后继通过 `'task[<任务ID>]' show` 或成功的 `'task[<任务ID>]' start` 得到相同来源规则的顶层 context，无需再复制登记：

```json
{
  "project_root": "/project",
  "contents": [{
    "read_path": "doc/tasks/integration.md",
    "summary": "集成验证",
    "mode": "live"
  }],
  "references": [{
    "source_task": "T-0012",
    "read_path": "doc/references/report-store.md",
    "summary": "保存接口、错误语义与代码索引",
    "mode": "live"
  }]
}
```

read_path 相对 project_root，snapshot 指向固定快照，来源与读取路径不同时另有 path。不可读时有 error；默认省略空类别，自身材料不重复 source_task。--detail 增加指纹、大小、完整来源和排除原因，不自动展开正文。标签 list 返回全部可见文件。完整契约见 [CLI 输出约定](../cli-output.md)。

旧文件式 reference、report 和普通产物的来源包括自身、直接完全依赖，以及部分依赖的父任务和 gate.requires 成员。日志、handoff 仅取自身。重叠 gate 按来源去重，相同文件由不同任务登记时保留不同来源。不沿祖先递归收集；外部正文链接也不递归展开。

### 代理查询的清单、用途和正文展开

普通 show 与 show --handoff 默认均为清单；--manifest 可明确锁定无正文模式。该版本有意改变旧行为：task.body、原始 history 和附件 body/html 不再默认返回。--handoff 返回 Markdown 索引，正文只在显式展开时加入。需要旧版正文的调用方应选择所需类别或路径，不再假设 show 会返回全部历史。

查询中的 GitHub 状态来自最近保存的同步记录；清单查询不读取全部附件重新计算远程内容指纹。直接编辑文件后通过 build/github sync 刷新发布状态。

```text
CLI 'task[T-0012]' show --manifest --cwd "<项目根目录>" --json
CLI 'task[T-0012]' show --handoff --expand content --expand report --preview --cwd "<项目根目录>" --json
CLI 'task[T-0012]' show --handoff --expand-path doc/reports/implementation.md --cwd "<项目根目录>" --json
CLI 'task[T-0012]' show --expand report --exclude-path doc/reports/tool-feedback.md --cwd "<项目根目录>" --json
```

--expand 可重复选择 content/contract/review-requirement/report/log/reference/handoff/output；--expand-path 可重复选择原始路径或 read_path。--exclude-path 精确匹配项目相对原始路径或快照路径，支持正反斜杠，不支持 glob；排除优先。--manifest 与正文选择互斥。--preview 不读取附件正文，返回 selected_files、selected_bytes、estimated_chars_upper_bound、omitted_count 和 excluded_count（--detail 可查 excluded）。字符数按 UTF-8 文件字节数与格式开销估计 UTF-16 长度上界，非 token 数；文件变化或读取错误会影响实际结果。

## 用途排除与历史材料

附件用途默认 agent；修改标记见 [绑定附件](attachments.md)。user 附件仍在 HTML 展示，但代理 context、显式展开及新生成 handoff 都排除，默认仅返回 excluded_count，--detail 在 excluded 中保留来源/路径/原因，不复制其摘要。用途不是访问控制或 GitHub 发布开关，已发布的评论不回撤；人工阅读使用 HTML。

旧自动 handoff（kind=handoff、path=snapshot、无新格式标记）可能已复制被排除的内容，默认以 legacy_aggregate 排除。原快照不改写；审阅确认适合代理后可用 set-audience 标为 agent。新自动 handoff 有 indexed-v1 标记，只冻结本任务要求与过滤后的索引。任意报告、手写 handoff 或任务正文里已经复制的其他资料无法自动追溯用途，需人工整理或标记整个附件；工具也不会自动解析聊天中的路径排除规则。

实时 CLI 清单给出当前 project_root；保存的 handoff 使用项目相对路径，不固化主控机器的绝对目录，便于换 checkout 后接手。

源码引用在离线 HTML 以转义文本呈现，脚本不会执行。参考列表显示来源路径，固定版本同时列出快照读取地址。

绑定文件须位于项目目录内。Markdown/text 正文内嵌在 HTML；PDF 等格式保留文件或快照链接，分享时需带上被链接文件并保持相对目录。

文件快照保存该附件自身的字节，不递归冻结引用的文件。本地 PNG/JPEG/GIF/WebP 按构建时内容嵌入 HTML；需单独留存的证据图片可以作为报告附件保存。外部网址保留链接。不可读的文件会在对应视图条目显示错误，按提示修复路径或文件后重新 build。
