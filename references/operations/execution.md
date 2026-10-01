# 执行者：领取、接手修复与受阻

本文 `CLI` 为 `node "<工具根>/dist/src/cli.js"`，命令带项目 `--cwd`，自动化加 `--json`；入口缺失见[准备与定位](bootstrap.md)。

## 领取与开始

复用 start 回执中的 context；已由主控开始或恢复执行时查询：

```text
CLI 'task[<任务ID>]' show --cwd "<项目>" --json
```

检查 status、claim 和 blockedBy。就绪且待开始时，用实际 role/session-id 执行 `start`；已开始但未领取时用 `claim`，属于当前会话则继续。其他会话占用、任务已结束或 unready 时交由主控安排。动态任务须先由主控 refine，reject 任务按复验安排 reopen。

修复 blocked 任务时，成功 start（必要时由主控 reassign/takeover）进入 in_progress 后再施工；成功 claim/reassign 同样完成状态转换，无须重复 start。读取 repair.previous_blockers 及关联报告，归档的原因不代表问题已解决，依赖/细化门槛仍须满足。

## 阻塞与恢复

无法继续时执行 `block --reason "<缺口与解除条件>"`；原因已保存，无需同义日志。block 保留领取和恢复阶段；已订阅图时自动通知主控，否则按 [task-take](../../skills/task-take/SKILL.md) 通知，日志本身不通知。

补齐信息后用 `unblock --reason "<原阻塞原因>"` 解除对应项；最后一项解除后恢复原阶段。修复仍受阻可再次 block，包括相同原因，形成新一轮阻塞。

审查受阻后，重审同一交付用 `.review restart`；修改交付须按派工重新接手，进入 in_progress 后修复并 complete。旧 reviewer 须先停止或 recover，细节见[审查控制](review-control.md)。
