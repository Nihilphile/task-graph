# 资源地址 CLI 实施记录

## 范围

新增 `graph[G-001].task[T-0001] <动作>` 寻址，支持任务集合、材料集合、依赖和 watch；保留旧命令、JSON 形状及存储格式。

支持 `task[T-0001]` 简写，以及多层 `task[T-0001].subgraph.task[T-0002]`。每层校验真实归属，缺少子图不会隐式创建。任务响应中的 resource 给出直接规范地址；自定义 graph ID 的特殊字符使用百分号编码。

资源路由、describe 和动作帮助使用已有 CommandSpec 定义。变更仍进入原有事务、生命周期、快照、GitHub 与通知逻辑；附件查询使用原有 agent context 过滤。图内批量创建拒绝越过集合范围，跨图或 parent_task 批次保留原入口。

## 验证

- 第一轮完整 `npm test`：250/250，通过旧语法、数据、GitHub、动态任务、通知和 HTML 回归，以及当时的 6 个新语法用例。
- 后续补充自定义 ID、watch、实际 PowerShell 参数传递与多层子图寻址，再编译并运行 resource-cli、US-001、US-022：24/24（其中新语法 10 项）。
- `npm run test:workflow`：5/5。
- task-graph、to-task、task-take、to-active-task 的 skill 格式校验通过；git diff --check 通过。
- 已有项目只读实测：`task[T-0006].subgraph.task list` 正确返回 7 个子任务。

所有写入测试使用临时项目，watch 测试使用注入适配器；没有向真实 Desktop 发送此次测试通知。安装入口为仓库 junction，已构建 dist，当前本地入口可用。

## 使用入口

详见 [资源地址 CLI](../../references/resource-cli.md)。SKILL.md、README、主控参考及三个配套 skill 已加入资源地址说明；保留兼容示例供已有调用者使用。此次未提交或推送。
