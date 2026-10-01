---
name: task-take
description: >-
  接手已分配的 task-graph 任务，自主执行、验证并交付，包括普通验收任务。
  持有 review-id 的独立审查者使用 task-review。
---

# Task Take

通过 junction/symlink 安装时，按真实文件位置解析以下链接。

## 接手

按[领取与受阻](../../references/operations/execution.md)取得 context 并确认执行身份。读取全部 contents、contracts、review_requirements，按需沿 code_references 定位源码；接续时读取必要报告、日志和 handoff，避免重复读取其已复制的要求。

明确范围、输入和验证方法后自主施工，无须二次许可或例行开工日志。拆分、refine 和范围调整由主控负责。

## 决策、日志与通知

主控未规定的事项在授权内自主决定。仅当可行方案之间有明显 trade-off（各有实质收益和代价）时，用 `.log add --text` 记录选择、收益、代价及影响，每项不超过 100 字。一个方案显著更优时直接执行，不记该决策。

日志另保留影响接续的重要失败、阻塞和路径变化，不记流水、不复制报告。

因未察觉中途修改导致返工或额外步骤时，按[错题本](../../references/error-book.md)记录一次实际损失；已随 reject 登记的同一事件不重复记录。

仅在需要主控决策、遇到阻塞，或决策／实现与主控决定冲突时通知；冲突部分暂停，其余工作继续。消息写问题、影响、所需处理及证据入口，使用已有通道，工具已通知的事项不重复发送。正常推进和完成不主动向父代理发消息。

## 交付与手册

验证后按[交付](../../references/operations/delivery.md)更新受影响 contract、登记报告和必要代码入口；kind=acceptance 按[验收任务](../../references/operations/acceptance.md)交卷。持有 review-id 时改用 [task-review](../task-review/SKILL.md)。

| 情况 | 手册 |
| --- | --- |
| CLI 或项目入口缺失 | [准备与定位](../../references/operations/bootstrap.md) |
| 材料路径、版本或用途不明 | [上下文](../../references/operations/context.md) |
| 中途交接 | [交付](../../references/operations/delivery.md) |
| 附件绑定或元信息修改 | [附件](../../references/operations/attachments.md) |
