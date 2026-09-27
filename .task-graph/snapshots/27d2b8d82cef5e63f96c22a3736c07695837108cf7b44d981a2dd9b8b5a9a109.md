# 动态任务图实现记录

## 范围与状态

图 G-004，总任务 T-0006；子图 G-005。

| ID | 实现项 | 状态 |
| --- | --- | --- |
| T-0007 | 多文件 Content 与地址清单/HTML/快照兼容 | done |
| T-0008 | 动态骨架、refine 指纹与 start/claim 门槛 | done |
| T-0009 | 独立验收 pass/reject、报告保留与显式复验 | done |
| T-0010 | Desktop graph watch、持久待发事件和恢复 | done |
| T-0011 | to-active-task 新技能 | done |
| T-0012 | task-take / to-task 配套 | done |
| T-0013 | 独立验收 | done / pass；见 acceptance-report.md |

独立验收已核对真实后续轮消费证据并通过；主控审阅验收报告后收口总任务 T-0006。本次 1 个总任务、6 个实现任务与 1 个验收任务全部完成。

## 接口入口

- `src/core/refinement.ts`：规划状态、输入指纹和执行中结构保护。
- `src/core/task-context.ts`：contents 数组及 content 兼容别名，参考仍只沿直接依赖收集。
- `src/core/lifecycle.ts`：reject、acceptance 证据要求和显式复验。
- `src/core/watch.ts`：订阅、结果事件、投递所有权、不确定结果与显式重试。
- `src/core/desktop-notify.ts`：当前 Windows Desktop 程序发现、版本门槛、参数数组和严格回执。
- `references/dynamic-workflow.md`：完整使用约定、故障恢复和当前边界。

新技能已通过 junction 安装到本机 `.codex/skills/to-active-task`，指向仓库内 skills/to-active-task。task-graph、task-take、to-task 的既有本地链接继续使用仓库当前版本。未推送远程。

## 验证

1. 初轮全套 239/240；发现旧 context.content.summary 被多文件改动遗漏。已恢复兼容字段，不删原测试。
2. 修复后完整 `npm test`：243/243 通过，0 skipped。原始日志 `output/dynamic-final-tests.log`，约 294 秒。
3. 静态 `npm run test:workflow`：5/5，通过原建图/恢复/门槛/GitHub模拟流程。
4. 最后增加投递前核对任务历史、注册本地忽略规则、同配置刷新 Desktop 绑定和节点规划提示；构建后针对 watch/dynamic/multi-content/reference-context 17/17 通过。最新复验日志保存在 output/dynamic-targeted-tests.log。
5. CLI `skill validate` 和项目 `validate` 均无 issues；三个配套技能的 skill-creator quick_validate 通过。
6. 独立空白上下文试用报告：skill-eval.md。发现批量 planning/kind 白名单遗漏，已修复并通过实际批量重试；补齐父任务的 refine/start 收口说明。
7. 当前 Desktop 真实测试先取得严格 queue receipt，随后主控结束 turn，在后续 turn 实际收到同一事件并读取报告。观察记录见 desktop-smoke.md；这证明本次已加载 busy 根会话的后续轮投递，不扩大为其他运行状态的兼容保证。

## 已知边界

- Desktop 仅支持已列入版本门槛的 Windows 桌面程序；当前轮注入、跨机器、未加载会话、退出/切页等不属于本轮已验证保证。
- accepted 表示队列接收，不是模型消费 ACK；uncertain 不自动重发。
- 无常驻系统服务；已保存但尚未投递的事件由下一次修改或显式 flush 恢复。
- refine 记录主控判断并检测输入变化，不证明语义完整，也不是强身份权限认证。
- 单条与批量创建切换时，旧稳定 key 的请求指纹可能不同；恢复应沿同一入口，冲突时查已有任务并续接，不重建。
