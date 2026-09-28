# blocked 接手与 unready 语义

## 约定

- `readiness=unready`：前置依赖、部分完成点或动态细化门槛未满足，不能 start。它不把 todo 改为 blocked，也不是需要主控处理的执行失败通知。
- `status=blocked`：执行遇到障碍，等待处理。它本身不阻止 start；前置条件已具备时，readiness 可以是 ready。
- blocked 任务成功 start/reopen/claim/reassign 后进入 in_progress。当前等待原因归档到 `repair_started` 历史和 CLI 的 `repair.previous_blockers`，不宣称障碍已经修好；若仍无法继续，重新 block。原因文字相同也会登记新的通知事件。
- 只读查询和追加日志不代表接手。task-take 要求执行者确认进入 in_progress 后再施工。

## 根因与改动

复现命令：`node --test --test-isolation=none dist/tests/blocked-repair.test.js`。修复前 start 不允许 blocked→in_progress，claim/reassign 成功但保持 blocked；通知按进入 blocked 的状态变化登记，因此修复者再次 block 时无法形成新一轮通知。

四个接手入口共享同一事务内的修复接手逻辑，保存交接快照并返回接手上下文。重复等待时仍去重，不通过反复报告同一状态制造通知。领取冲突、依赖和动态细化检查保留，失败不改任务或审查记录。

人工问题仍可用 unblock 记录外部解除，最后一项解除后恢复原阶段。进入修复则结束本轮等待，由执行者重新报告仍然存在的问题。

审查受阻有两种继续方式：

| 意图 | 操作 | 结果 |
| --- | --- | --- |
| 重审同一份交付 | `.review restart` | pending_review → reviewing，沿用冻结材料 |
| 进入任务修改交付 | `start/reopen/claim/reassign` | in_progress，旧轮次归档，旧交卷失效 |

旧 reviewer 仍在运行时拒绝接手，以免两个执行者同时改动验收对象。修复后 complete 按当前 auto-review 配置提交新交付或正常完成；审查报告与历史轮次保留。

## 接口与看板

`task list --readiness unready` 筛前置条件；`--status blocked` 筛执行受阻。原 readiness 值 blocked 改为 unready，未就绪错误改为 E_TASK_UNREADY；status 的 blocked 保持不变。blockedBy 仍列举诊断原因，manual 项不再决定 readiness。

看板区分灰色 unready 和红色 blocked，分别提供 readiness 与 status 筛选。已生成的离线 HTML 在下一次 build 或任务修改后更新。相关 Skill、主控参考和审查说明已同步。

## 验证

新增回归覆盖四个接手入口、同原因二次 block 两次投递、无变化不重复通知、审查 blocked/failed 转入修复、旧轮次失效、活进程保护、领取冲突、前置门槛与 unready 语义。使用临时项目和假 Desktop 适配器，不发送真实通知。
