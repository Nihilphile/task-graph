# 新版本真实多任务验收

日期：2026-09-28。受测版本：`codex/auto-review`，提交 `feefc72`。本轮未修改功能代码、未合并旧版本，也未切换已安装 Skill。

## 实际运行

创建独立 Git 测试项目及 G-001，共 7 个任务。由控制脚本准备明确的正确/错误交付，经新版本 CLI 提交；工具自动或手动启动真实 `codex exec`，由模型实际检查文件、执行断言、写报告并调用 `.review finish`。未使用模拟审查结果。

模型均为默认 `gpt-6-sol` / `xhigh`。共 5 个独立 Codex 会话，均正常退出，退出码 0。任务 reject 表示审查发现不合格交付，不表示审查进程失败。

| 任务 | 场景与实际证据 | 最终结果 |
| --- | --- | --- |
| T-0001 | 自动审查；两份 content、两份 RR；实际运行正确的整数加法断言，并核实快照 Git 根目录为独立验收目录 | pass / done |
| T-0002 | 自动审查；实现故意以减法代替加法；审查者实际运行断言，发现 `-1 !== 5`、负数用例也不符，写入反例 | reject |
| T-0003 | 未启用 auto-review；先 complete 成为 done，读取执行报告、附 RR 后手动 review start；实际读取配置并断言数字 3 和布尔值 true | pass / done |
| T-0004 | 首轮环境文件缺失，审查者提交 blocked；主控补齐环境文件后 restart，审查者读取实际环境及交付配置，再提交 pass | blocked → restart → pass / done |
| T-0005 | 依赖 T-0001；其 pending_review 时 start 失败，通过后可 start 和 complete | done |
| T-0006 | 依赖 T-0002；其 pending_review 及 reject 后的 start 均失败 | todo，依赖阻塞 |
| T-0007 | 依赖 T-0003；手动 review 重新开启验收门槛时 start 失败，通过后可 start 和 complete | done |

另外验证：

- 无 RR 的任务 enable 被拒绝；图扫描开启三个有 RR 的任务，跳过另外四个无 RR 的任务。
- 自动 complete 返回 pending_review；手动 start 将 done 转为 pending_review。
- restart 产生新轮次，但 delivery 与 materials 均与旧轮次完全相同；未改动交付源码和 RR。
- 旧 blocked 轮次尝试提交 pass 被拒绝，不影响当前轮次。
- `. validate` 与 `. build` 成功。

## 运行身份

| 任务/轮次 | Review ID | Codex session |
| --- | --- | --- |
| T-0001 | d4ded605-45ca-487c-9a67-8b8d326b9b04 | 01a0e532-7798-7e60-a825-5b12345ab9d6 |
| T-0002 | 1b2118c9-74cd-4b31-a5e6-b0fab7503bea | 01a0e532-8d2b-7111-b60d-d237a624ccfd |
| T-0003 | 63a987a6-b1e8-4568-bf6c-07581099e6dd | 01a0e532-f75a-7a92-b087-f69f77791cf2 |
| T-0004 首轮 | 73f5522a-de6e-475e-8f3a-5e49a39b1091 | 01a0e532-b2fc-78f2-b9e1-9c114b4cc050 |
| T-0004 重启 | c2ce4ee5-9ab8-4d42-9a04-90dfba27ede2 | 01a0e535-7d06-7251-ad9d-183821931359 |

## 本机证据入口

以下输出保留在本机 `output/review-real-scenarios`，不随 Git 发布：

- [HTML 看板](../../output/review-real-scenarios/project/.task-graph/generated/index.html)
- [全部 CLI 请求与响应](../../output/review-real-scenarios/commands.jsonl)
- [最终断言结果](../../output/review-real-scenarios/verified.json)
- [运行脚本](../../output/review-real-scenarios/run.mjs)
- [自动通过报告](../../output/review-real-scenarios/project/.task-graph/reviews/d4ded605-45ca-487c-9a67-8b8d326b9b04/report.md)
- [自动 reject 报告](../../output/review-real-scenarios/project/.task-graph/reviews/1b2118c9-74cd-4b31-a5e6-b0fab7503bea/report.md)
- [手动审查报告](../../output/review-real-scenarios/project/.task-graph/reviews/63a987a6-b1e8-4568-bf6c-07581099e6dd/report.md)
- [环境 blocked 报告](../../output/review-real-scenarios/project/.task-graph/reviews/73f5522a-de6e-475e-8f3a-5e49a39b1091/report.md)
- [重启后通过报告](../../output/review-real-scenarios/project/.task-graph/reviews/c2ce4ee5-9ab8-4d42-9a04-90dfba27ede2/report.md)

## 范围

本次真实运行覆盖 snapshot 模式、自动/手动启动、pass/reject/blocked、restart、旧轮次拒绝和依赖门禁。环境恢复使用源码捕获范围外的专用测试环境文件。没有绑定 Desktop 订阅，没有向任何现有主控发送消息；不把本次结果当作真实桌面通知、Unity 现场或进程强杀恢复的验证。
