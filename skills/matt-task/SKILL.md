---
name: matt-task
description: >-
  承接 Grill 或已讨论需求，替代 Matt Pocock to-spec 与 to-tickets：把结论整理为 task-graph
  的 spec contract，再按纵向切片创建任务要求与依赖。支持仅生成 spec、从已有 spec 建图或修订计划；
  完成于可执行任务图，不负责 Grill、实施、派工和整图收口。
---

# Matt Task

一个规划入口，两个阶段：**已有讨论 → spec contract → 可执行任务图**。采用 Matt 的 spec 与 tracer bullet 方法，以 task-graph CLI 保存成果。两阶段共享已确认结论，不运行 `to-spec`、`to-tickets` 或 `to-task` 的另一套工作流。

## 从当前阶段进入

读取当前会话结论和用户指定的材料，识别授权范围及现有成果。已有结论直接继承；事实缺口查项目，实质未决选择明确指出，不重新启动 Grill，也不把假设写成已确认决定。

| 当前输入 | 进入哪里 |
| --- | --- |
| Grill 结论、已讨论需求或明确计划 | 整理 spec，再拆任务 |
| 已有 spec 文档或 contract | 检查其可施工性，复用或登记后直接拆任务 |
| 只要求形成 spec | 完成 spec contract 后结束，不创建施工任务 |
| 修订已有计划 | 读取目标 spec、现有 ID 与受影响任务，局部修订 |
| 未经讨论且目标不清晰的想法 | 交代影响规划的缺口，建议先独立 Grill |

只要求讨论时给出可审阅结果；已授权生成 spec 或建图时直接保存成果，复用已确认的 seam 和拆分，不设置例行二次批准。用户另有实施要求时，完成本技能的规划交付后把已明确工作交给 `matt-task-take` 或已有主控入口；实施和调度不属于本技能。

## 1. 形成 spec contract

需要形成、检查或修订 spec 时读取 [Spec 阶段](references/spec.md)。成果是一份项目内权威 Markdown spec，由一个 contract 登记同一文件；不另维护 issue spec 或复制版 contract。

覆盖用户问题、预期行为与用户故事、已确认实施决定、测试 seam 和验收条件、排除范围及必要来源。篇幅随实际范围决定。现有接口优先于新增接口，验证优先选择最高且能观察目标行为的公开边界。已有契约复用原 ID 和文件。

contract 表示当前约定，不表示实现完成，也不替代任务依赖。变更 spec 时指出受影响要求和任务；历史依据留在 Git 或已有快照。存在影响施工的未决问题时保留明确标记，相关部分不宣称可执行。

完成条件：spec 文件、contract ID 和适用范围可以定位，已确认行为及验证边界足以拆任务；关键未决项明确披露。

## 2. 形成任务图

进入拆分或建图时读取 [Tickets 阶段](references/tickets.md)。每项任务交付一条窄而完整、可独立验证的行为，覆盖所需层；机械迁移按 expand–migrate–contract 组织。任务范围与 spec 要求逐项对应。

content 只写本任务目标、范围、输入入口、验收和交付责任，绑定共享 spec contract，避免复制全文。父任务正文和聊天不会自动继承。父子表示归属，depends_on 表示等待产物，共享写入另说明协调安排。

准备完整要求及稳定 key 计划，用 CLI 批量落图并保存 key→实际 ID 回执。已有任务用原 ID 修订，新工作才另建。必要代码入口使用 reference，contract/reference 均不替代执行依赖。

完成条件：spec 每项要求已由任务承接或有明确排除/待定理由；任务材料可读、约束与验证方法明确、ID 和依赖可查询，HTML 可打开。validate 只证明结构，不能替代要求覆盖和空白上下文检查。

## 交付与边界

交付 spec 路径与 contract ID、任务要求入口、实际任务地址及依赖、HTML 和未决问题。仅完成 spec 时交付第一阶段成果，明确任务尚未拆分；规划完成不宣称实现或用户验收通过。

首次操作或 CLI 入口不明时读 [CLI 定位与保存规则](references/task-graph.md)。本技能只修改规划材料与图结构，不领取施工、不启动代理/审查、不做实施提交、不完成施工任务。用户授权远程发布时使用 task-graph 已有同步能力，避免另写 tracker 数据。

## 方法来源

改编自 Matt Pocock 的 [to-spec](https://github.com/mattpocock/skills/blob/main/skills/engineering/to-spec/SKILL.md) 和 [to-tickets](https://github.com/mattpocock/skills/blob/main/skills/engineering/to-tickets/SKILL.md)：保留讨论结论综合、公开测试边界、纵向切片和真实阻塞边，将成果保存为 task-graph contract 与任务。入口所需方法在本技能中定义，不依赖原技能的 tracker 设置。
