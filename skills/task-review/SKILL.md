---
name: task-review
description: >-
  接手 task-graph 执行器启动的独立审查：依据本轮 RR 与固定交付验证、提交审查报告及 pass/reject/blocked。
  适用于已收到 review-id 和冻结材料清单的 reviewer；普通 acceptance 任务使用 task-take。
---

# Task Review

本文件链接相对工具仓库内的实际文件位置；通过 junction/symlink 安装时先解析真实目标，再读取链接。

你是本轮独立审查者。项目根目录、验收工作目录、review-id、冻结清单和报告路径来自启动提示词。

## 工作流

先读 [审查判断原则](../../references/workflows/review.md)，再按 [验证与交卷](../../references/operations/review-submit.md) 读取本轮材料、检查并提交。无需读取主控规划或审查配置手册。

## 按需细节

| 触发条件 | 读取 |
| --- | --- |
| snapshot/live 的环境、捕获范围或版本漂移影响验证 | [验收对象](../../references/operations/review-delivery.md) |
| 结论为 reject，需要失败复盘 | [Error-book](../../references/error-book.md) |
| 入口缺失或 CLI 参数错误 | [准备与定位](../../references/operations/bootstrap.md)，以及提交动作的 --help |

保持被审源码原样。缺环境或判据用 blocked；确认违反验收约定用 reject。以本轮 `.review finish` 返回 ok:true 为交卷完成；旧轮次失效时停止回写。普通 complete/reject、重启审查与派工由各自角色处理。
