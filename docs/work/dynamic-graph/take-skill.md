# 执行技能配套与静态工作流兼容

## 要求

task-take 读取全部有效 content，动态骨架不能领取；上下文确认后自主施工；区分实现、验收与父任务统筹。登记 reference 后交付，独立验收按预定条件给 pass/reject，不降低要求。to-task 保留一次细化模式，明确与 to-active-task 的选择关系。更新任务图文档、帮助与安装入口。

## 输入与交付

项目：task-graph 仓库；CLI：dist/src/cli.js；源码 src/core、src/cli，测试 tests。
原有技能 skills/to-task 与 skills/task-take。Desktop 参考实现：F:/AI_project/subagent-cli/oneshot/src/delivery.js；验收 oneshot/docs/host-notify-hn06-acceptance.md。参考其机制，不操作该项目的用户任务。
新增代码须覆盖真实行为和失败边界。报告写在本目录，登记可供后继定位的接口或文档 reference。
