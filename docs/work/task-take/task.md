# 接任务指南与 CLI 提示

## 背景与目标

用户确认：子代理 task start 后，从 CLI 返回的路径读取 task-take skill。读完任务内容和必要 reference，确认范围、接口及验证入口后写简短接手工作记录，随后自行开工，无需主控二次许可。开工前或施工途中缺少上下文时记录缺失信息、影响与解除条件；无法继续时同时 task block，可推进部分继续。结果与证据回填任务，无需另外编写重复的主控回执。

补充确认：task-take 应指导执行者在 complete 前登记后继所需 reference。优先绑定已有文件并用摘要说明用途；确有需要时编写短接入说明，任务明确约定的参考须交付。

## 范围与入口

新增随 task-graph 分发的 skills/task-take/SKILL.md，并在本机 skills 目录提供入口。src/cli/commands/task-status.ts 为 start/reopen 的 JSON 与文本成功响应提供 guidance，原 context 保留；task show 同样提供路径，支持主控已 start 的接续场景。指引路径基于工具位置，不能基于被管理项目的工作目录；绝对路径不写进持久化任务、handoff 或 HTML。

当前资料：src/cli/commands/skill-validate.ts 的 defaultSkillRoot、src/core/task-context.ts 的地址清单；SKILL.md 的领取/完成/阻塞语义；../to-task/SKILL.md 的派工入口。图结构、状态模型与调度器保持现有实现。

## 验收与交付

构建和相关 CLI、领取、接手与 Skill 测试通过。验证返回路径真实可读，支持不同项目目录、JSON/文本/quiet、失败与已开始场景，打包包含指南。通过真实任务记录接手、回填报告，生成本地图。检查指南明确自动开工与阻塞处理；不以结构测试冒充独立 agent 行为评测。本轮不提交或推送。
