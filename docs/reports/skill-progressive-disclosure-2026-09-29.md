# Skill 审计与渐进式披露重构（2026-09-29）

## 范围与发现

审计 task-graph、to-task、to-active-task、task-take，以及它们调用的主控、动态、审查、附件和 CLI 参考。基线为 5825ef0。此次未实现讨论中的 worktree/本地 CI。

1. task-graph 入口 308 行，混合角色介绍、顺序教程、附件/通知/审查细节与完整旧命令表。每次普通接手都加载无关操作。
2. to-task 和 to-active-task 混合规划判断与 CLI 教程，并重复派工、reference、审查、通知规则；一处接口变化需多处更新。
3. task-take 混合普通施工、独立验收和主控审查恢复。持有 review-id 的 reviewer 没有自己的 Skill 路由，主要依赖代码内提示词。
4. controller-workflow 的 294 行覆盖批量、子图、材料、上下文、展开、维护；dynamic-workflow 混合细化和 Desktop 投递机制。标题不能准确限定读者。
5. skill validate 原本强制 SKILL.md 内含全部命令，测试还要求入口出现特定教程词句，妨碍渐进式披露。

## 新结构与职责

| 入口 | 使用者与职责 | 工作流 | 按需操作 |
| --- | --- | --- | --- |
| task-graph | 按角色和当前动作发现工具 | 主控协作或转对应 Skill | 按功能查手册 |
| to-task | 主控，一次性详细规划 | static-planning | 创建、关系、上下文设计 |
| to-active-task | 主控，动态骨架与持续判断 | dynamic-planning | 增补要求、关系、refinement |
| task-take | 已分配任务的执行者 | execution | 接手/受阻、材料、交付；acceptance 按需 |
| task-review（新增） | 持有 review-id 的独立审查者 | review | review-submit；验收对象/失败复盘按需 |

`references/workflows/` 保留思想、职责和判断依据；`references/operations/` 保存命令、前提、状态效果和恢复方式。watch、GitHub、附件等作为功能手册，避免给每项命令建立独立 Skill。动态规划继续以认知和事实支持判断，未改成固定的 A→B→C 清单。

主控说明需要哪些后继知识；task-take 指导执行者怎样登记 reference。普通验收任务通过 task-take 使用 complete/reject，独立 reviewer 通过 task-review 使用 .review finish。主控配置和 restart 手册从 reviewer 的必读路径移出。

旧 controller-workflow.md、dynamic-workflow.md、review.md 保留为短路由，已有链接仍可进入功能手册。命令目录搬至 references/commands.md；资源地址文档聚焦寻址与命令发现。

## 入口体量

下表统计 UTF-8 解码后的字符数与行数，不是 token 数；它衡量入口加载量，不代表一次完整任务只需读这些内容。

| 入口 | 原行数 | 当前行数 | 字符数 |
| --- | ---: | ---: | ---: |
| SKILL.md | 308 | 50 | 14094 → 2012 |
| skills/to-task/SKILL.md | 158 | 33 | 6906 → 1321 |
| skills/to-active-task/SKILL.md | 128 | 36 | 6172 → 1345 |
| skills/task-take/SKILL.md | 90 | 30 | 5128 → 1152 |
| skills/task-review/SKILL.md | 新增 | 26 | — → 866 |

## 按需阅读场景核对

| 场景 | 阅读路径 | 结果边界 |
| --- | --- | --- |
| 主控批量建静态任务 | to-task → static-planning → planning；需要时读 task-context | 保存稳定 key 和实际 ID，复杂子图才读 relationships |
| 主控收到前置完成 | to-active-task → dynamic-planning → refinement | 前置完成不自动放行；可补调查/能力/决策依赖 |
| 子代理接手 blocked 修复 | task-take → execution 工作流/操作 | 成功接手必须 in_progress，旧原因可读；再次 block 是新事件 |
| 普通执行者完工 | task-take → delivery | 先登记必要 reference，再 complete；pending_review 结束本轮职责 |
| kind=acceptance 交卷 | task-take → acceptance | 明确 pass/reject 及报告，reject 附 error-report |
| 自动/手动 reviewer | 启动提示词 → task-review → review / review-submit | 使用冻结清单和 review-id，不普通 complete、不自行 restart |
| 主控恢复异常审查 | task-graph → review-control | 重审原交付与接手修复分开 |

这是文档阅读路径与接口核对，不宣称已经做过独立真实模型的行为评估。

## 程序与安装配套

- start/show 的 guidance 继续返回 task-take 实际路径，提示缩短为入口说明。
- 新审查启动提示词提供安装位置下的 task-review 绝对路径；本轮身份、路径、冻结清单和提交命令仍由执行器生成，通用验证细节放进手册。已生成的旧轮次提示词不被改写。
- skill validate 校验独立命令目录，并从入口递归检查包内 Markdown 链接。测试覆盖完整包换位置后路由可达，以及缺失 reviewer 手册/命令目录时报错。
- 本机原 Skill 是指向仓库的 junction（to-task 为两级链接），随源码更新生效。手册按实际链接目标解析；分发须保留完整仓库，不能只复制单个 skills 子目录。task-review 由程序和总入口直接路由，无须单独全局安装。
- 保留 to-active-task 的显式调用策略。未改变任务状态机、依赖或订阅行为。

## 验证

- TypeScript 构建通过；五份 Skill 均通过 skill-creator quick_validate（Windows 下显式 UTF-8）。
- skill validate 的命令目录及引用路由检查通过。
- Skill 包、执行者入口和审查运行相关回归 18/18 通过，包含生成提示词中的 reviewer 路径与实际轮次交卷。
- 首次配套工作流测试 4/5；剩余一条仍把未完成前置的 readiness 断言为旧值 blocked。已按现行语义改为 unready，复验 5/5 通过。
- 最终构建、skill validate 和 git diff --check 通过。相关自动化测试合计 23 项通过；未重新运行整个项目的全量回归。
- 未向真实项目派工、未启动付费 reviewer、未发送 Desktop/GitHub 通知。
