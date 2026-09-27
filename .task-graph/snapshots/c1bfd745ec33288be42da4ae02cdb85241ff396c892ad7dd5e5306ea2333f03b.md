# T-0003 验收报告

## 交付

本次用当前 to-task 的要求文件与稳定 key 批量计划建立 G-001，并通过 task-graph 依次开始、登记参考、交付和完成三个任务。实际执行会话均为 /root，未启动独立验证 Agent。

- reference 用于登记供后继读取的文件，默认 live，支持 --snapshot。
- report/log/handoff/reference attach 及 handoff create 支持可选 --summary。
- show/start/reopen 默认返回 context，其中包含要求文件和自身/直接依赖参考的地址、来源、摘要与读取模式。引用正文不加入该清单。
- 部分依赖包括父任务与对应 gate.requires 成员；不递归收集所有祖先。
- HTML 参考标签按自身/依赖分组，先列文件，再打开具体内容；代码预览转义。
- task-graph 与 to-task 使用说明已对齐。

## 实际接手证据

`acceptance-start.json` 是 T-0003 的真实 start 返回，包含本任务 content，以及 T-0001、T-0002 登记的 reference、summary、source_task 和 read_path。主控无需将前置文件清单重新复制进后继任务。

## 验证

修复后的完整回归 `npm run test:only`：227/227 通过，0 失败。测试原始输出保存在同目录 regression.txt。

首次完整回归 227 项中 226 项通过，发现 handoff 将本机绝对根目录持久化，破坏不同 checkout 的确定性。已修复：持久化交接采用项目相对路径；实时 CLI context 保留当前 project_root。相关 13 项测试复跑全部通过，包含 reference 行为及完整投影测试组。

to-task 工作流 5 项通过；TypeScript 构建、两份 Skill 格式校验、CLI skill validate 与项目 validate 通过；git diff --check 无空白错误。

## 使用观察与边界

- 本轮解决前置参考的重复登记和主控手工拼接地址问题；执行者仍需按 summary 选择并读取文件。
- to-task 继续负责把必要背景、范围和验收要求写清楚。字段存在、依赖 ready、文件可读，均不能证明任务语义充分。
- 本次是实际工作流和自动测试验证，未做独立空白上下文 Agent 的接手评测。
- 默认 live 参考会随代码变化；需要固定交付版本时显式使用 --snapshot。
- show 的既有任务与报告字段保持兼容；新增 context 是地址清单，并未把整个 show 改成仅返回地址。
- GitHub 通过离线 mock 覆盖；未向真实仓库发布测试 issue。reference 只生成 issue 索引，正文不会作为评论自动发送。
- 修改保留在本地，未提交或推送。
