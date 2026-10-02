# Tickets 阶段

从可定位的 spec contract 开始。只有 spec 文档时先按 [Spec 阶段](spec.md) 检查并登记；已有 contract 足够施工时直接复用，不重写结论。首次 CLI 操作读 [定位与保存规则](task-graph.md)。

## 切片与依赖

每项工作交付一条窄而完整的用户行为，覆盖实际所需的 schema/API/UI/验证等层，以一位空白上下文执行者可以完成为粒度。前置整理或调查仅在有独立产物和真实等待点时单独成任务。

对每项给出标题、交付行为、验收条件和阻塞它的产物。逐项核对 spec 要求有承接，避免按代码层拆成无人负责端到端行为的流水线。共用文件或希望排顺序本身不是业务依赖；共享写入安排和集成责任另写清。

机械迁移例外采用 expand–migrate–contract：先兼容新旧形式，分批迁移，最后移除旧形式。每批能独立通过时各自验证；不能独立通过时明确共同集成位置、各批验证边界和最终验收责任。

已授权建图且约定充分时保存可审阅拆分，不要求例行再批准；仍有实质未决选择时只处理影响它的部分。当前承诺交付可执行任务图，不把未知方案写成已经确定的施工要求。用户明确选择动态规划时可以保留骨架，并如实标明未 refine、暂不可执行；不默认强加动态放行步骤。

## 每项任务的 content

独立文件写本任务目标、范围与排除、它承接的 spec 要求编号/章节、输入与前置产物定位、测试 seam/验收、交付位置及后继需要的知识。短任务可短写，不要求固定模板。

将 spec contract 绑定到每个相关任务，父级绑定不会自动继承。content 明确本任务只承接哪些故事/行为，共享 spec 的其他切片不算本任务漏实现。局部适用时可以引用有明确 ID 的 contract 章节，同时保留所需全局约束；默认整份 spec 即可。

spec 全文、共享规则和 CLI 管理的状态/依赖不重复维护在每项 content 中。需要当前代码定位时登记或引用已核实的 reference；公开约定仍在 contract。要求与 Markdown 链接按各自文件位置可解析，不能引用“前面讨论”。

## 落图与重试

先准备 content 文件，再写 plan.json。以下示例的 G/C 编号和路径执行时替换为真实图、spec contract 和材料；key 取项目内唯一的功能前缀。

```json
{
  "graph": "G-001",
  "tasks": [
    {
      "key": "feature-core",
      "summary": "打通最小完整行为",
      "content": "docs/tasks/core.md",
      "contracts": ["C-0001"]
    },
    {
      "key": "feature-variation",
      "summary": "支持已约定的行为变化",
      "content": "docs/tasks/variation.md",
      "contracts": ["C-0001"],
      "depends_on": ["@feature-core"]
    }
  ]
}
```

```text
CLI task add --from "<plan.json绝对路径>" --cwd "<图项目>" --json
```

content 路径相对图项目根，--from 相对调用位置，使用绝对计划路径避免歧义。保存返回 keys→ID；@key 用于批量引用，不是 T-编号。相同 key 和原创建参数可安全重试；改变创建参数会产生 key 冲突，已有任务改用 revise。整批创建失败回滚，不逐项无 key 重建。

需要在已有父任务下规划时，使用 parent_task（真实 ID 或同批 @key）；顶层 task add 支持该批次，图内 task 集合不支持 parent_task。父子表达归属，子任务默认加入父任务完成目标，但父任务不自动完成；不强制每个功能都另建统筹任务。

spec 在所有消费者上通过 contracts 显式绑定。额外已存在代码入口通过 references 绑定；contract 与入口不满足 depends_on。需要部分完成点或跨子图关系时，查真实工具根 `references/operations/relationships.md` 的 CLI 参数，不沿角色流程指针扩大职责。

## 修订与交付检查

修订前查询指定图的现有任务、稳定 key 和材料。保留既有 ID，先协调受影响的 in_progress/pending_review/reviewing 工作，再修改约定；审查中被冻结的材料不能随意改绑定。取消/替代/完成目标调整按真实范围处理，cancelled 不代表前置产物交付成功。

要求正文可以直接编辑后 validate/build；绑定、摘要和关系用 CLI revise/attach/dependency 操作，动作参数通过 --help 查询。不要用新 key 重建相同任务来逃避修订或重试冲突。

交付前逐项检查：

- 每项 spec 要求由任务覆盖、明确排除或明确待定，不能被遗漏。
- 每个任务绑定适用 spec contract，content 明确自身范围与可验证行为。
- 依赖对应真实等待点，输入与关键路径在执行者环境可读；结构校验不证明可并行施工。
- 查询实际任务 ID、依赖和 readiness；HTML 构建成功。动态骨架或未决项如实披露，不标成 ready。

给出 spec 路径及 contract ID、任务地址/依赖、要求入口、HTML 和未决事项。下一步实施入口是 matt-task-take；本阶段不 start/claim/complete、不派代理、不修改自动审查策略。
