# 独立验收任务：提交结果

本文的 `CLI` 表示 `node "<工具根目录>/dist/src/cli.js"`；所有调用带目标项目 `--cwd`，结构化输出加 `--json`。入口未确定时读 [准备与定位](bootstrap.md)。

适用于 task.kind=acceptance。持有 review-id 的自动/手动 reviewer 使用 [审查交卷](review-submit.md)。

当 task.kind=acceptance 时，依据事先确定的验收要求独立验证。报告逐条记录 pass/reject、原生证据、实际代码/构建版本和未覆盖项，区分亲自观察与引用前置报告。环境或资料缺失导致无法验证时，按[领取与受阻](execution.md)登记 block 及解除条件，不据此判定产品失败或通过。

```text
CLI 'graph[<图ID>].task[<验收ID>]' complete --result pass --report <报告路径> --cwd "<实际项目路径>" --json
CLI 'graph[<图ID>].task[<验收ID>]' reject --report <失败报告路径> --error-report <失败小报告.md> --cwd "<实际项目路径>" --json
```

二选一执行；验收任务必须明确结果并提交本轮报告。reject 前按[error-book 指南](../error-book.md)写一份简短复盘，通过 --error-report 一同提交；也可在本轮验收报告中包含复盘后让两个参数指向同一文件。两者都保存证据并释放领取；reject 不满足后继依赖或父任务完成目标。独立验收中发现实现缺陷交由主控安排修复，避免自行扩大范围修复后直接宣布独立通过。复验保留先前报告并提交新证据。图已订阅 watch 时结果自动进入通知队列，执行者无需另发提醒。
