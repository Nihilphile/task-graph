---
name: task-graph
description: >-
  维护项目任务图：通过 CLI 创建任务、绑定任务要求和报告、建立执行依赖、记录领取与状态，
  并生成离线可读的 HTML。适用于从已确认的 PRD 或聊天任务建图、接手已有任务图、
  维护任务及子图、登记交付、校验与构建视图。
---

# Task Graph

本文件链接相对工具仓库内的实际文件位置；通过 junction/symlink 安装时先解析真实目标，再读取链接。

使用 `$task-graph` 管理项目任务图和离线 HTML。本入口按角色与当前操作路由；选中一条后只读该分支，遇到具体操作再打开对应手册。

## 按角色进入

| 当前职责 | 入口 |
| --- | --- |
| 主控维护已有任务、派工、根据报告继续判断 | [主控工作流](references/workflows/controller.md) |
| 主控把已确认需求一次性详细拆分 | [to-task](skills/to-task/SKILL.md) |
| 用户选择骨架规划、按信息逐步细化 | [to-active-task](skills/to-active-task/SKILL.md)，与 to-task 二选一 |
| 执行者接取或修复任务，包括普通验收任务 | [task-take](skills/task-take/SKILL.md) |
| 独立 reviewer 已收到 review-id 与固定材料 | [task-review](skills/task-review/SKILL.md) |

## 按需操作

首次使用或入口缺失，读 [准备与定位](references/operations/bootstrap.md)。`CLI` 是 `node "<工具根>/dist/src/cli.js"` 的缩写；每次带目标项目 `--cwd`，自动化加 `--json`。具体参数通过 `CLI '<资源地址>' describe` 或动作的 `--help` 查询。

| 需要做什么 | 操作手册 |
| --- | --- |
| 单项/批量建任务 | [创建计划](references/operations/planning.md) |
| 子图、依赖、完成目标、gate | [关系](references/operations/relationships.md) |
| 读文件清单、来源或正文 | [上下文](references/operations/context.md) |
| 共享契约、代码入口或一次登记已定决策 | [契约与条目](references/operations/contracts.md) |
| 绑定 content、RR、report、log、handoff | [附件](references/operations/attachments.md) |
| refine / unrefine | [动态细化](references/operations/refinement.md) |
| start、重派、blocked 修复 | [执行与受阻](references/operations/execution.md) |
| complete 或中途交接 | [交付](references/operations/delivery.md) |
| 主控配置/恢复 review | [审查控制](references/operations/review-control.md) |
| Desktop 订阅 | [通知](references/operations/watch.md) |
| 发布 issue / 恢复同步 | [GitHub](references/github-sync.md) |
| 修订、校验或生成 HTML | [维护](references/operations/maintenance.md) |

## 最小约定

- 图组织任务；父子表示归属，depends_on 数组表示执行前置。ID 使用工具返回值。
- readiness=unready 表示依赖或细化未满足；status=blocked 表示执行受阻。blocked 接手修复成功后进入 in_progress。
- 查询默认返回文件索引；--detail 增加元数据，正文按需读取。结构化状态和关系通过 CLI 修改。
- 普通施工由主控派工；启用 review 才由工具启动审查者。通知与附件不扩大用户授权。

仅在查地址语法时读 [资源地址](references/resource-cli.md)；查返回字段时读 [输出契约](references/cli-output.md)；维护 CLI 时读 [命令目录](references/commands.md)。
