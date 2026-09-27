# T-0005：代理交接改进

## 评估

用户反馈成立：旧 handoffText 自动串入前置报告/普通产物和自身报告/日志；普通 show 通过全图投影返回附件正文。start/handoff create 的自动快照复用了聚合结果。新增 reference 清单本身无法阻止这些入口展开不需要的内容。

本轮针对实际存在的正文选择和附件用途问题改动，不增加与本次反馈无关的依赖或迁移模型。

## 实现

- show 和 --handoff 默认 manifest：任务事实、阻塞、文件路径/摘要/来源/读取模式；不默认返回 task.body、历史正文、附件 body/html。
- --expand 按 content/report/log/reference/handoff/output 类别重复选择；--expand-path 按来源或快照路径选择。--exclude-path 精确排除，排除优先，不支持 glob。
- --preview 仅检查文件元数据，返回所选条目、字节数、UTF-16 字符数估计上界、未展开数量和排除原因。估计不是 token 数，文件变化会影响实际展开。
- 四种 attach 支持 --audience agent|user；已有附件通过 task output set-audience 更新同来源路径所有版本，快照保留。user 附件从代理清单及显式展开排除，HTML 仍展示并标注用途。
- 默认 task list 同样采用事实/元数据路径，不再为查询渲染所有附件，用户专用附件摘要也不出现在列表输出。
- 旧自动聚合 handoff 默认以 legacy_aggregate 排除，保留文件；主控审阅后可显式标为 agent。新快照标记 indexed-v1，只冻结当前要求和过滤后的索引，避免再复制报告/日志全文。
- context reports 补充直接前置报告，保留 source_task/read_path/summary/live 或 snapshot。日志与 handoff 仅取自身。引用仍遵循现有直接依赖及 gate 成员规则。
- to-task、task-take 和工具帮助已同步。查询中的 GitHub 状态读取已保存的同步记录，清单查询不读全部附件重新计算发布指纹。

## 验证

隔离回归先复现默认 handoff 带入反馈正文，再验证：默认无正文、用户反馈与实现报告共存时的过滤、HTML 保留用户附件、多快照/参考的来源与读取位置、预览只读、路径选择与排除优先、已有附件补标而不改变快照、旧聚合隔离。

完整回归 234/234 通过，原始输出见 regression.txt。后续查询列表与已保存 GitHub 状态的调整通过相关 18 项回归，最后的查询状态缓存调整再复核 5 项交接/只读测试全部通过；to-task 工作流 5/5。最终构建和三份 Skill 校验通过。未向真实 GitHub 发布测试 issue。

## 真实项目只读验证

对 F:/AI_project/The-Game/unity-try 使用 show --handoff --manifest，只输出计数，不展示附件正文、不修改项目。check-project.mjs 为可复跑脚本。

| 任务 | 用户提供的旧 handoff 字符数 | 新 handoff 字符数 | 展开文件数 |
| --- | ---: | ---: | ---: |
| T-0037 | 76,747 | 2,769 | 0 |
| T-0039 | 43,744 | 2,299 | 0 |
| T-0040 | 3,096 | 242 | 0 |
| T-0069 | 45,625 | 2,495 | 0 |

两侧按 UTF-16 code units 计数。旧值来自用户本轮报告，未重新输出旧正文。新值测于本轮修改时。

## 使用与兼容边界

旧脚本若依赖 task.body、history 或附件 body/html，需改为读取清单或显式选择正文。默认行为变化是本次消除意外展开的必要部分。

真实项目附件未补标：未经标记的普通附件仍默认为 agent。需要长期排除工具反馈时，用 set-audience 在其产出任务补标；临时查询可传 --exclude-path。工具不会自动解释聊天或项目交接文件中的路径排除声明。

用途不是文件访问控制，也不是 GitHub 发布开关，已发布评论不会回撤。任意文本中手工复制的其他材料无法被工具可靠追溯；需人工整理或排除整个附件。已有快照不回溯改写。

本轮无独立空白上下文 Agent 行为评测。全部修改保留本地，未提交或推送。
