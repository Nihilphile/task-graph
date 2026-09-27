# 动态细化与领取门槛

## 要求

新增可选 dynamic 规划模式：骨架依赖满足只进入待评估，显式 refine 后可领取；依赖/内容变化让待开始任务重新待评估。记录评估依据。主控可通过现有 add/link 补调查、决策和实现任务；已开工要求变化需明确协调，不静默激活。旧静态任务保持原行为。

## 输入与交付

项目：task-graph 仓库；CLI：dist/src/cli.js；源码 src/core、src/cli，测试 tests。
原有技能 skills/to-task 与 skills/task-take。Desktop 参考实现：F:/AI_project/subagent-cli/oneshot/src/delivery.js；验收 oneshot/docs/host-notify-hn06-acceptance.md。参考其机制，不操作该项目的用户任务。
新增代码须覆盖真实行为和失败边界。报告写在本目录，登记可供后继定位的接口或文档 reference。
