# Graph watch 与 Desktop 后续轮提醒

## 要求

graph watch G-ID --thread UUID 显式订阅图及子图；--status 只读，unwatch 取消。注册前事件不补发，重复注册幂等。任务成功/拒绝都生成持久事件，独立于 GitHub/HTML。短通知固定来源，报告用指针。使用 Desktop 捆绑 exe queue，不用 npm CLI resume。已接受不等于已处理；不确定投递不自动重发；只可证明未发送时重试。Windows 隐藏后台进程恢复待发事件，版本能力必须检查。当前 0.158.0-alpha.2.1 需实机定向验证，旧证据只覆盖 0.153.4。

## 输入与交付

项目：task-graph 仓库；CLI：dist/src/cli.js；源码 src/core、src/cli，测试 tests。
原有技能 skills/to-task 与 skills/task-take。Desktop 参考实现：F:/AI_project/subagent-cli/oneshot/src/delivery.js；验收 oneshot/docs/host-notify-hn06-acceptance.md。参考其机制，不操作该项目的用户任务。
新增代码须覆盖真实行为和失败边界。报告写在本目录，登记可供后继定位的接口或文档 reference。
