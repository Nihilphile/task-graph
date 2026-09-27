# 独立验收

## 要求

用隔离项目通过公开 CLI 验证：单/多 content 兼容，HTML 文件列表；骨架依赖完成仍不能 start，refine 后才可，新增依赖/改内容重新评估；reject 不释放后继且父任务不通过，复验 pass 可；watch 显式注册/幂等/子图/不回补/取消/恢复/不确定结果不盲重发。用进程 fixture 检查 Desktop 参数和严格回执，版本门槛。针对当前 Desktop 做有界真实通知验证并分开记录历史证据、本轮观察、未测边界。独立空白上下文试用 to-active-task 与 task-take。执行相关回归，输出逐条证据及未通过项，主控无需重跑。

## 输入与交付

项目：task-graph 仓库；CLI：dist/src/cli.js；源码 src/core、src/cli，测试 tests。
原有技能 skills/to-task 与 skills/task-take。Desktop 参考实现：F:/AI_project/subagent-cli/oneshot/src/delivery.js；验收 oneshot/docs/host-notify-hn06-acceptance.md。参考其机制，不操作该项目的用户任务。
新增代码须覆盖真实行为和失败边界。报告写在本目录，登记可供后继定位的接口或文档 reference。
