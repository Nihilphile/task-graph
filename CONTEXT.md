# Task Graph

任务图描述工作的要求、依赖和交付。以下术语用于本分支的独立审查能力；实现与验证范围见 [交付说明](docs/work/auto-review-delivery.md)。

## Language

**契约（contract）**：共享的当前规则节点，维护唯一正文；任务关联表示必须遵循，不参与执行门禁。

**代码入口（reference）**：可复用的路径、行号、符号和最多 30 字说明条目；旧文件式参考仅保留兼容读取。

**决策登记（decision record）**：一次事务记录已定决定、契约及消费者关系，不代表实现已经完成。

**验收要求（review-requirement，RR）**：任务的验收条件、验证方法和证据要求，可由多份文件共同表达。

**自动审查（auto-review）**：任务提交交付后，由工具启动独立审查者，依据验收要求检查交付的机制。

**手动审查（manual review）**：主控阅读执行报告、确定验收要求后，主动启动的独立审查。它与自动审查使用相同的报告和结果提交机制。

**待审查（pending_review）**：任务已提交审查，等待审查线程启动。

**审查中（reviewing）**：执行器收到 Codex 的 thread.started 回执，审查者已接手；记录会话 UUID，等待有效验收结论。两种状态都不放行完整依赖，也不发送完成通知。

**审查报告（review report）**：审查者记录检查、证据和结论，并附到被审查任务上的交付材料。

**通过（pass）**：交付满足验收要求的结论，对应任务完成。

**未通过（reject）**：交付不满足验收要求的结论。审查进程异常本身不构成未通过。

**无法验证（blocked）**：审查者因缺少环境、材料或判据而无法完成验收的结论；它不表示交付已经被证实不合格。

**审查重启（review restart）**：异常或无法验证的审查重新执行，保留原审查记录并使旧审查结果不能覆盖新结果。

**受阻（blocked）**：显式暂停的任务状态。人工阻塞保存原阶段和领取，解除最后一个原因后恢复；独立审查无法验证或执行异常则保存 blocked_from=pending_review。重审原交付使用 review restart；接手修复使用 start/reopen/claim/reassign，进入 in_progress，旧阻塞原因归档，旧审查只保留历史。再次 block 是新一轮通知。

**未就绪（unready）**：前置依赖或动态细化门槛尚未满足的派生 readiness；不改写 todo 状态，不产生 blocked 通知。人工或审查问题属于 status=blocked，本身不阻止 start。

**错题本（error-book）**：聚合 rejected / error_recorded 历史中的复盘。reject 必须提供 error-report；实际返工可用 record-error 独立登记，不改变状态。blocked 本身不自动追加错题。
