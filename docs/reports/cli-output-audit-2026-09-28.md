# Task Graph CLI 输出评估

日期：2026-09-28。评估版本：`8ffc5de`。

## 结论

建议采用你的原则：**默认输出只回答本次调用要解决的问题；审计、追溯和排障材料按 `--detail` 获取。**

当前主要问题是命令复用了过大的对象，而不是 JSON 缩进太多：

1. **查询重复。** `task show` 同时返回 `task.outputs`、`task.documents`、`context`，其中很多是同一批文件；启用 handoff 格式后又增加一份表达。
2. **写入后返回范围过大。** 追加一条日志会返回任务正文与全部附件；绑定一个 reference 会返回所有历史附件。
3. **不同目的共用审查视图。** 查询 auto-review 开关、查询运行、提交审查结果，都返回 `reviewView`，连冻结材料清单也一起返回。
4. **有些回执很短，但还不够有用。** complete 回执不确认本次保存的报告入口；review recover 不明确说本次恢复了什么；只删除字段不能解决这些问题。

应优先处理 `show/list`、日志与附件写入回执、review 系列。`build`、`validate`、领取与依赖修改等已有不少合理输出，应保留它们的有效信息。

**本轮只形成评估报告和测量材料，没有修改产品代码、CLI 行为、Skill 或真实项目状态，也没有推送。**

## 1. 评估方法与边界

- 静态检查注册表中的 **57 个命令**，以及资源地址额外提供的 describe、graph/file/dependency/subgraph/errorbook 查询。
- 通过实际 CLI `main()` 入口采集 **45 个样本**：36 个隔离测试项目样本，9 个 unity-try 只读样本。
- 隔离项目覆盖领取、日志、附件、阻塞、自动审查提交、审查结果、订阅等。审查状态由本地 fixture 驱动，Desktop 使用假适配器；没有启动真实 reviewer、发送桌面消息或发布 GitHub issue。
- 真实项目只查询 G-014/T-0107。没有展开附件正文，没有把项目正文复制到报告；证据文件记录字段结构、长度和汇总指标。
- 长度采用 JavaScript `String.length`，另记录 UTF-8 字节数；**没有把字符数当作 token 数**。实测时间为 2026-09-28 16:08 左右（北京时间），项目状态可能继续变化。
- 候选精简是对采样对象进行字段投影的估算，不是已经实现的协议，也不是最终预算。

测量证据：[样本指标与字段清单](cli-output-audit-2026-09-28-samples.json)。采样脚本在本地 `output/cli-output-audit.mjs`；测试项目在 `output/cli-output-audit-*`，不属于产品代码。

## 2. 用什么标准决定字段去留

对每个字段问：**它是否会影响调用者此刻的判断、下一步操作，或本次结果的确认？**

| 调用目的 | Agent 实际想知道的事 | 默认应该回答 |
|---|---|---|
| 发现用法 | 这里能做什么，这个动作怎么调用？ | 操作名、短说明、必要语法；有针对性的条件 |
| 找任务 | 哪个任务能派、哪个在等、哪个在审？ | 标识、摘要、状态、可开工性、有效领取及阻塞 |
| 接任务 | 我拿到了吗、读什么、可以开工吗？ | 领取结果、完整要求入口、RR、依赖参考、接手 Skill 入口 |
| 写入事实 | 保存成功了吗、实际改变了什么？ | 本次变更和实际保存位置，不回放旧数据 |
| 查开关 | auto-review 究竟开没开？ | 明确的 enabled 值；必要时说明策略例外 |
| 查审查运行 | 启动了吗、谁在审、卡住了吗？ | 当前阶段、轮次、会话、模型、时间、当前错误或结果入口 |
| 收尾 | 我交卷成功了吗、还需做什么？ | 最终保存的状态、本次报告/复盘入口、必要的下一步 |
| 排障或审计 | 为什么这样、哪次运行、哪个快照？ | 用 `--detail` 返回身份、快照、指纹、历史和底层诊断 |

同一字段在不同动作里的必要性不同。例如 `enabled:false` 是 `.auto-review status` 的核心答案；每次 `.reference attach` 都带它没有帮助。审查失败时 `error` 是默认必需信息，不能因为它长就放进 detail。

### 三条具体约定

- **写命令返回变更，读命令返回所查询的视图。** attach 默认只返回这次绑定，list 才返回集合。
- **一个事实只出现一次。** 文件清单保留一种结构；不要同时维护主 content 对象、contents 数组、documents 镜像和 outputs 镜像。
- **省略无关字段，保留有含义的空值。** `.reference list` 的 `files:[]`、`.auto-review status` 的 `enabled:false` 必须保留。普通成功回执不需要 `errors:[]`、`result:null`、`current:null` 等与本次动作无关的空壳。

## 3. 实测输出

### 真实项目

| 调用 | 当前字符数 | 候选精简字符数 | 估计减少 | 主要保留内容 |
|---|---:|---:|---:|---|
| `task[T-0107] show --json` | 29,852 | 4,032 | 86.5% | 任务事实、一套分类文件入口、来源、当前审查摘要 |
| `task[T-0107].review status --json` | 7,355 | 419 | 94.3% | 状态、轮次、触发方式、模型、会话、错误/结果入口 |
| `task[T-0107].auto-review status --json` | 6,712 | 56 | 99.2% | 任务 ID 与 enabled |
| `graph[G-014].task list --json` | 41,585 | 4,214 | 89.9% | ID、摘要、状态、readiness、动态阶段、阻塞、有效领取 |

这些是方向性估算：例如最终 review status 还应保留启动/结束时间，发现材料被过滤时可增加计数。因此不能把 419 或 56 宣称为最终格式的固定大小。

其他样本：G-014 auto-review status 为 **18,546** 字符，graph show 为 **2,610** 字符，T-0107 reference list 为 **3,452** 字符，show --handoff 为 **32,728** 字符。此次 G-014 watch status 的订阅和事件数组为空，302 字符；不能用它代表积累大量事件后的输出。

T-0107 的 show 中，`task.documents` 约 8,468 字符，`context` 约 8,544 字符，`task.outputs` 约 2,453 字符。还另含完整 `task.review`。这是多个视图叠加，而不是任务本身必须提供近三万字符的接手入口。

### 隔离项目

| 场景 | 字符数 | 评估 |
|---|---:|---|
| `task describe` | 12,217 | 首次发现一个节点操作就收到所有动作的长语法和说明 |
| `review describe` | 4,957 | 六个动作重复同一组说明；status 也解释手动 start |
| 新任务 `log add` | 1,573 | 主要多余内容来自全部 outputs |
| 旧正文任务 `log add` | 4,069 | 追加一句话却返回原正文和旧工作记录 |
| `handoff create` | 2,028 | 返回全部附件，而不是本次 handoff |
| `reference attach` | 894 | 本次只添一个 reference，却返回三个附件，含用户专用附件元数据 |
| `complete`，启用 auto-review | 194 | 已比较简短，但未确认本次报告保存位置、排队轮次 |
| `review finish` | 3,493 | 收尾回执仍返回整套审查材料 |
| `build` | 160 | 基本合理：生成位置和规模 |

## 4. 优先问题与依据

### P1：`task show` 的重复清单，以及 list 的全部 outputs

Agent 用 show 建立任务视图，用 list 做筛选。当前 show 同时输出 `contentPath`、`documents.content`、`documents.contents`、`context.content`、`context.contents`，附件也有多种镜像；list 对每个任务返回所有可见 outputs。

建议：

- show 默认保留任务状态、依赖和必要的上下文清单，但只保留一套 `context`/`files`。
- 所有 content 和 RR 都应能找到，不能只留第一份；直接前置 reference 的来源不能丢。
- reports/logs/handoffs 可保留一次紧凑索引，避免没有入口；不默认带正文、历史和快照哈希。
- list 移除完整 outputs、重复 graph/resource、静态默认值、由 status 可直接推出的 result。动态任务的 planningState、真实阻塞、有效领取仍默认保留。
- `refinement.fingerprint`、长评估原因、supersedes、derivedFrom、审查冻结材料等由 detail 提供。

依据：`src/cli/commands/task-inspect.ts:44–62、102–112`，`src/core/task-context.ts`。

### P1：写入回执返回旧上下文

`log add` 返回 `{id,body,outputs}`；附件 attach、handoff create 返回 `{id,outputs}`。随着历史积累，每次小写入的输出越来越大。

更具体的问题：隔离样本在绑定 agent reference 时，输出中出现了先前 `audience:user` 报告的路径/元数据。这一回执不经过 taskContext 的受众过滤。**此次没有发现该调用返回用户报告正文**，不应把元数据问题夸大为已证实正文泄露；但它与这次 reference 绑定无关，应删除。

建议默认返回本次变更对象，包含实际 `read_path`；detail 若提供相关集合，仍沿用 agent 可见范围。不要因为 detail 打开，就展开用户专用正文。

依据：`src/cli/commands/task-annotations.ts:25`，`src/cli/commands/task-documents.ts` 的 attach/handoff create。

### P1：review 配置、运行和结果使用同一个大对象

当前 `reviewView` 含开关、默认配置、当前轮次配置、交付工作区、捕获时间、文件数量、冻结 materials。它被 auto-review 的 enable/disable/status、review 的 start/restart/finish/status/configure/recover、图策略列表复用；status 又追加 runs 列表。

建议拆成三个输出视图：

1. **策略**：是否启用；图扫描需列本次启用与跳过原因。
2. **当前运行**：task status、轮次、trigger、模型、会话、开始时间、当前错误或报告入口。
3. **写入结果**：本次排队、重启、交卷或配置实际结果。

submission、材料清单、workspace、文件数量、PID、历史 runs、重复配置进入 detail。若需要主控介入，错误、失败阶段和可执行恢复指引默认保留。

`pending_review` 不能被写成“reviewer 已启动”，`reviewing` 也不等于“全部验证已完成”。输出必须准确表达这些差别。

依据：`src/core/review-state.ts:76`，`src/cli/commands/review.ts:40、52、67`。

### P2：describe 和 help 没有按动作定向

`operations` 与 `actions[].action` 重复，`children` 是完整地址清单，每个 action 又重复 notes。三条通用 preconditions 还会出现在非任务执行类资源上。

建议 describe 默认只给可操作性判断、动作名+短说明和子资源名称。完整语法与长 notes 放到 describe --detail；`<动作> --help` 本身就是明确求用法，必要语法、参数和前提应直接给出，且只解释该动作。

`exists:false`、归属不符时的 `actual_resource` 不能隐藏。它们直接决定下一条命令如何写。

依据：`src/cli/resources.ts:187–209`；review 各动作共用 details 的实现。

### P2：订阅变更回传整份队列概览

watch add/remove/retry/flush 共用 watchStatus，因此注册或取消订阅会同时返回 subscriptions、各类计数、最多 20 个事件、投递与消费说明。

建议 add/remove 只确认目标 graph/thread 和 active 状态；retry 返回所选事件的新投递状态；status 才返回订阅是否有效、队列统计和**当前需要处理的异常事件**。历史 accepted/cancelled、桌面版本、所有尝试时间与 receipt 放进 detail。

`uncertain`、`paused` 的 event ID、错误和恢复方法默认可见；不能为了短而隐藏“送没送到不确定”。`accepted` 只代表接收成功，不代表主控已经阅读，简化后也不能改变这个含义。

依据：`src/cli/commands/graph-watch.ts`，`src/core/watch.ts:125–133`。

### P2：有些输出缺少“这次究竟做成了什么”

- `complete/reject`：应返回本次 report/复盘的保存入口；auto-review 提交应返回排队轮次。不能只看几百字符就认定无需调整。
- `review recover`：应告诉调用者本次发生了恢复、旧线程接续、仍在运行还是无事可做。当前丢弃 recover 返回结果，随后照常输出大 reviewView。
- `content/RR remove`：只有 `{task:{id}}`，宜增加移除的路径；不需要把整个任务带回来。
- 批量 task add 的任务投影没有显式 status，与单任务 add 不一致；现在创建时就可能 blocked，默认回执应保留这一事实。
- `task complete` 的命令 summary 仍描述 in_progress → done，与启用 auto-review 时实际 pending_review 有差异；输出合同和帮助文字应共同校对。

### P2：格式和参数合同不一致

实际探测：

- 资源式 `task[...] show --detail` 返回用法错误；旧式 `task show ... --detail` 被静默接受，却没有 detail 语义。
- review status 即使没有 `--json`，仍输出 JSON；`--quiet` 也没有让它安静。
- JSON 错误同时输出到 stdout，格式化错误又写 stderr；工具捕获两个流时同一个问题出现两次。

实施时必须把 detail 纳入统一参数白名单和布尔解析，让新旧语法使用同一输出视图。它不能只是某几个处理器中的特殊判断。

JSON 模式建议 stdout 只输出一份可解析结果，包含完整的必要错误；stderr 用于未被结构化结果表达的诊断。文本模式提供等价的业务信息。quiet 的合同需统一，不能隐式启用详细输出。

依据：`src/cli/args.ts`、`src/cli/resources.ts` 参数校验、`src/cli/commands/review.ts`、`src/cli/main.ts:118–131`。

## 5. 按功能划分的默认输出建议

下表覆盖 57 个注册命令及额外资源查询；“detail”是未来建议，**当前尚未实现**。

| 功能 | 调用者想得到什么 | 默认保留 | 移到 detail 或不重复输出 |
|---|---|---|---|
| `init` | 是否初始化、从哪里进入 | project_root、入口图/任务地址、成功结果 | schema 与配置细节 |
| `graph add` | 新图在哪里、属于谁 | 图 ID/地址、entry 或 parent、显式发布结果 | 未改变的项目注册表 |
| `graph list/show` | 找图、看图内任务概况 | 图标识/摘要、父子入口、任务 ID/摘要/status | 完整 registration、所有附件、重复地址 |
| `task add` 单个/批量 | 创建了哪些、能否派工 | ID、canonical address、status、readiness、阻塞/动态阶段；批量 key→ID | 重复输入正文、每项重复 HTML 地址、创建指纹 |
| `task revise`/replace | 修订或替换生效了吗 | 任务 ID、本次改变字段；替换后的新 ID 与关系 | 整份任务、旧历史 |
| `task list` | 筛选派工与异常 | ID、摘要、status、readiness、有效领取、动态阶段/阻塞 | outputs、result 推导值、静态默认项、重复父图 |
| `task show` | 建立当前任务视图 | 任务事实、依赖、一套精简材料索引、当前 review 摘要 | 镜像清单、指纹、完整轮次/来源历史、通用教程 |
| `start/reopen` | 是否接手、读什么 | 状态、实际 claim、project_root、全部 content/RR、直接前置 reference、相关接续入口、Skill 路径 | 旧日志正文、历史报告正文、SHA、完整执行教程 |
| `claim/release/reassign` | 当前归谁、释放/转交成功吗 | ID、status、实际 role/session；release 明确 claim=null | claimed_at、execution_id 等审计字段（有专门用途时再返回） |
| `complete/reject` | 交付保存成功吗、结束还是待审 | status、本次报告/复盘 read_path、待审轮次、必要下一步 | 所有历史 reports、完整 reviewView |
| `cancel` | 是否取消 | ID、最终状态 | 要求、附件、历史 |
| `block/unblock` | 阻塞是否生效、还能继续吗 | status、有效原因、恢复阶段；解除后必要的剩余阻塞/readiness | 全部状态历史、其他附件 |
| `refine/unrefine` | 是否可派工 | planning_state、readiness、当前阻塞 | refinement fingerprint、原样回显长评估理由 |
| `dependency list` | 等待哪些前置/完成点 | 前置 ID/地址、状态、mode/gate、是否满足 | 无关材料、来源全任务 |
| `link/unlink` | 这条边是否改变、是否影响就绪 | 本次前置关系、结果、必要的就绪变化 | 所有不变边；需要完整集合再 list |
| `attach-subgraph/set-completion/expose-gate` | 子图/完成契约改成什么 | 对应子图、这次完成目标或完成点及 requires | 完整 child graph 内容、无关完成点 |
| `subgraph show` | 如何进入、如何算父任务完成 | 子图地址、completion_requires、暴露完成点 | 子图所有任务正文 |
| `content/RR/reference/report/log/handoff attach` | 这次绑定成功且读哪里 | 类型、read_path、必要的 path/mode、summary | 所有旧 outputs、时间、actor、哈希 |
| `content/RR remove`、`output remove` | 哪个绑定已移除 | task、移除路径、必要的剩余要求提示 | 全部剩余附件 |
| `output add/set-audience` | 输出/可见性登记结果 | 本次路径和 audience；仅登记未验证存在时不要伪造可读结论 | 全附件清单 |
| 文件集合 `list` | 有哪些可读材料 | project_root 一次、read_path、有效摘要、依赖来源、snapshot/live 语义、必要 section/error | 重复 path、重复 title、SHA、size、audience 默认值、排除路径明细 |
| `log add` | 记录成功并存在哪里 | log read_path、追加成功；有稳定条目 ID 则返回 | 旧任务 body、旧日志、全部 outputs |
| `handoff create` | 得到哪个交接入口 | 本次 handoff read_path/摘要 | 整套 outputs |
| `.auto-review enable/disable/status` | 开关与实际策略 | ID、enabled；配置修改时返回修改项的有效值 | 当前审查冻结材料、报告、全部默认配置 |
| 图 `.auto-review enable/status` | 哪些任务启用、哪些没启用 | 每个目标 ID+策略/本次扫描结果，跳过原因 | 每任务 current.materials、workspace、完整配置重复 |
| `.review start/restart` | 是否排队、哪轮、审什么版本 | review ID、task status、trigger、有效模型/模式、重启时关联前轮 | 全 materials、PID、运行目录清单；版本身份可用一次 head/submission 表达 |
| `.review status` | 排队、审查中、结束还是故障 | status、review ID、trigger、session、实际模型、开始/结束时间、error 或 report | 历史 runs、PID、workspace、完整材料、重复 policy config |
| `.review finish` | 交卷是否生效 | review ID、最终 status/result、本轮 report/error-report 入口 | 输入材料、启动配置、所有历史轮次 |
| `.review recover` | 本次修复了什么 | 检查对象、本次恢复/未恢复结果、当前 status、需行动原因 | 完整 reviewView、全部历史 |
| task/project review configure | 哪些配置生效 | 修改项及最终有效值/覆盖层级 | 当前审查材料、无关任务设置 |
| watch add/remove/retry/flush/status | 订阅/通知是否生效 | 对应目标与操作结果；status 的计数和待处理异常 | 全部历史事件、底层版本、尝试时间与 receipt |
| `errorbook list/show` | 查失败、读取指定复盘 | list 给失败 ID、task、时间、复盘入口；读取动作给请求范围正文 | 默认列举不展开所有历史正文；全量复盘应显式请求 |
| `source add` | 来源登记结果 | source ID、file；本次确认时间有审计用途，可保留 | 所有旧来源 |
| `graph publish/github sync` | 远端是否成功 | 当前对象 URL、synced/pending、当前错误和待同步量 | fingerprint、issue 映射、历史重试 |
| `validate/skill validate` | 有什么必须修 | ok；失败时 code/file/field/message | 成功时空诊断、运行内部信息；不把有效错误藏进 detail |
| `build` | HTML 在哪里、是否生成 | HTML 路径、成功结果；图/任务数可保留 | 完整 graph.json/HTML 字节；当前实现没有输出这些正文 |
| `describe/help` | 能做什么、该怎么写 | 可用动作、简述；动作 help 的必要语法/参数/前提 | 重复 operations/actions、无关通用 preconditions；describe 长例子进 detail |

注意：errorbook 目前没有按条目选择的完整读取接口，表中的“读取指定范围”是设计建议，不是已有能力。GitHub 网络行为未实测，仅静态检查输出包装；本次不宣称验证了真实远端同步。

## 6. 文件指针的取舍

文件指针不是越短越好，目标是让空白上下文 agent 能准确读到所需文件。

建议默认指针：

```json
{
  "read_path": ".task-graph/snapshots/abc.md",
  "summary": "来源额度接口及错误处理约定",
  "source_task": "T-0041",
  "mode": "snapshot"
}
```

- `read_path` 是实际读取入口，优先保留。`project_root` 在外层出现一次。
- 依赖材料保留 `source_task`；当前任务所属的文件不必逐项重复 source_task/scope。
- snapshot/live 会影响“读的是固定交付还是当前内容”的判断，不能把这一语义全部藏起来；可约定默认 live，只在 snapshot 时输出 mode。
- `path` 与 read_path 相同可省略。若原路径对解释材料身份有用，可保留 origin_path；不要把所有原路径一概删除。
- summary 优先；没有 summary 时保留有辨识度的 title，不强迫读取者猜哈希文件名。
- 文件位于任务正文某一节时，`section` 必须保留；引用不存在或读取失败时，error 必须默认可见。
- SHA、size_bytes、added_at、actor 通常进入 detail；`--preview` 明确要求预算时，大小就是核心信息，应直接输出。

## 7. `--detail` 应如何与现有模式配合

建议把两个维度分开：

| 控制项 | 负责什么 |
|---|---|
| 默认 / `--detail` | 业务摘要或更多元数据、来源和诊断 |
| `--expand` / `--expand-path` | 是否读取并输出正文，读取哪些正文 |
| `--preview` | 本次显式展开预计涉及哪些文件、多少字节 |
| `--handoff` | Markdown 交接表达；同一材料不重复输出一套 JSON 镜像加一套正文 |
| `--json` | 表达格式，不应决定业务信息量 |

**detail 不等于展开所有文件，也不覆盖 audience/user 排除规则。** 详细信息也应与当前功能有关；`.auto-review status --detail` 可以解释配置覆盖关系，但没有必要把历史日志正文塞进去。

不要用静默截断实现精简。若查询集合确实很大，应明确提供筛选/分页、总数和未返回范围；这是一项后续接口设计，当前 CLI 还没有统一分页能力。任务接手所需的 content/RR 清单不能截掉后让 agent 误以为已读全。

## 8. 建议的默认输出示例

以下是未来协议草案，ID 和路径为说明用例，不表示当前 T-0107 的实时结果。

### 查询开关

```json
{
  "ok": true,
  "task": "T-0042",
  "enabled": false
}
```

enabled=false 与“当前有人手动审查”可以同时成立；运行情况通过 `.review status` 查询，不应把 policy 和 run 混为一谈。

### 追加工作记录

```json
{
  "ok": true,
  "task": "T-0042",
  "log": { "read_path": ".task-graph/logs/T-0042.md" }
}
```

### 提交交付，等待自动审查

```json
{
  "ok": true,
  "task": "T-0042",
  "status": "pending_review",
  "reports": [{ "read_path": ".task-graph/snapshots/def.md" }],
  "review": { "id": "本轮UUID", "state": "queued" }
}
```

这里不默认报告“主控已通知”。队列登记、Desktop 接收、主控消费是不同事实，不能用简短字段制造已完成的错觉。

### 查询正在运行的审查

```json
{
  "ok": true,
  "task": "T-0042",
  "status": "reviewing",
  "review": {
    "id": "本轮UUID",
    "trigger": "manual",
    "session_id": "审查会话UUID",
    "model": "gpt-6-sol",
    "started_at": "2026-09-28T09:18:41+08:00"
  }
}
```

这些示例强调信息范围，尚未决定最终命名、嵌套及协议版本。不能直接把原 task 对象改成字符串后假定现有调用者继续兼容。

## 9. 实施顺序与验收建议

### 第一批：收益最大，先固定合同

1. 定义每个动作的默认输出，而非直接序列化领域对象。
2. log/attach/handoff 的写回执只返回本次变更。
3. review 的策略、运行、提交结果分别投影。
4. show 清单去重，list 移除完整 outputs。
5. 统一 detail 参数与旧式/资源式语法，再同步 Skill、示例和测试。

### 第二批：发现、监控与兼容

- 精简 describe，按动作写 help。
- watch 变更回执与 status 分开。
- 规范错误单次输出、JSON/文本/quiet 行为，以及 GitHub pending 的显式提示。
- 检查同仓 Skill、脚本和外部调用者依赖的旧字段。历史脚本不可能靠静态检查本仓就全部证明兼容；必要时提供明确的协议版本/过渡方式。

### 验收要测“完成工作”，不只测字符数

| 用例 | 应证明什么 |
|---|---|
| 空白上下文 agent start | 一次回执能找到所有 content、RR、所需 dependency reference 与 task-take 入口 |
| 各绑 1 与 100 个历史附件后再 attach/log | 默认写回执只随本次变更增长，不随历史累积增长 |
| 查看 auto-review 开关 | 没有 materials/runs/workspace；false 明确可见 |
| queued → reviewing → pass/reject | 默认状态准确，交卷入口完整，启动阶段不误报已完成/已通知 |
| 阻塞或启动失败 | 默认包含具体障碍和可执行下一步，不能先 detail 才知道失败原因 |
| 批量任务创建含 blocked | 每项真实状态可见，key→ID 对应明确 |
| snapshot 与 live reference | Agent 能区分固定交付和当前文件，来源与 read_path 正确 |
| 用户专用反馈附件 | 无关写回执不回传旧附件；detail/expand 仍遵守受众边界 |
| 新旧语法 + json/text/detail | 相同动作业务信息一致；未知参数明确报错，不静默忽略 |
| 跨项目路径与多个前置 | 不依赖调用者猜当前目录，也不丢来源任务或 partial gate |
| 订阅 uncertain/pending、GitHub pending | 精简不把“尚未确认”表述为“已送达/已同步” |

建议给输出预算设回归上限，但预算必须按对象数量和任务复杂度分级。不要为了满足固定字符数而删除全部阻塞原因或漏掉要求文件。

## 最后判断

这次改造值得做，方向很明确：**为每个动作定义它应回答的问题，再生成对应结果视图。** 最先解决的不是引入另一个 verbose 开关，而是停止把大领域对象当成所有命令的通用回执。`--detail` 是保留审计和排障能力的第二层。
