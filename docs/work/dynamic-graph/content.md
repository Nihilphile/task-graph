# 多文件任务要求

## 要求

支持创建/追加/移除多份 content，context.contents、显式展开、派工快照、HTML 列表、GitHub 要求一致。保留单文件和旧正文兼容。仅当前有效文件共同构成要求；追加不代表已细化。

## 输入与交付

项目：task-graph 仓库；CLI：dist/src/cli.js；源码 src/core、src/cli，测试 tests。
原有技能 skills/to-task 与 skills/task-take。Desktop 参考实现：F:/AI_project/subagent-cli/oneshot/src/delivery.js；验收 oneshot/docs/host-notify-hn06-acceptance.md。参考其机制，不操作该项目的用户任务。
新增代码须覆盖真实行为和失败边界。报告写在本目录，登记可供后继定位的接口或文档 reference。
