# 验收 pass/reject

## 要求

验收任务记录 pass 或 reject；reject 结束本轮并释放领取、保存报告，不能解除依赖或让父任务完成。支持有记录的复验。普通 complete 保持兼容。父任务完成仍由主控显式确认。

## 输入与交付

项目：task-graph 仓库；CLI：dist/src/cli.js；源码 src/core、src/cli，测试 tests。
原有技能 skills/to-task 与 skills/task-take。Desktop 参考实现：F:/AI_project/subagent-cli/oneshot/src/delivery.js；验收 oneshot/docs/host-notify-hn06-acceptance.md。参考其机制，不操作该项目的用户任务。
新增代码须覆盖真实行为和失败边界。报告写在本目录，登记可供后继定位的接口或文档 reference。
