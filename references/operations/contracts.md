# 当前契约、代码入口与决策登记

本文 `CLI` 为 `node "<工具根>/dist/src/cli.js"`，命令带项目 `--cwd`，自动化加 `--json`。

## Contract

同一能力只有一个 contract 节点和一份当前正文。任务的 `contracts` 表示必须读取并遵循，不参与 ready/complete；尚未实现的能力仍以 task 依赖等待交付。契约写规则、接口语义与边界，并明确尚未实现部分；改变契约的任务同步维护正文，旧决定和验证留在报告快照与 Git。

```text
CLI contract add --graph G-001 --title "材料许可" --file docs/contracts/material-permission.md --task T-0012 --task T-0013
CLI 'contract[C-0001]' show
CLI 'contract[C-0001]' update --text "<完整的新正文>"
CLI 'task[T-0014].contract' attach --id C-0001
```

新增可用 `--text` 直接保存正文，省去预先写文件；更新保持原权威文件路径。任务创建可重复 `--contract`，批量计划用 `contracts` ID 数组。解除关联用 `.contract remove --id`，保留契约。不把整份契约复制进任务要求；任务只补范围和验收差异。跨子图复用同一个 ID。

### 可选章节

同一文件可用二级标题 `## 付款提交 {#payment}` 定义可引用章节；ID 独立于标题文字，正文包含其下级标题，直到下一个一级或二级标题。未标记 ID 的文档仍可整份引用。

```text
CLI 'task[T-0012].contract' attach --id 'C-0001#payment'
CLI 'contract[C-0001]' show --section payment
CLI 'task[T-0012]' show --expand contract
```

任务创建的 `--contract` 和计划的 `contracts` 数组也接受 `C-0001#payment`；多个章节分别绑定。整份引用优先，缩小范围时先解除整份绑定。主控自行选择范围，工具不自动附加 common 或其他章节。任务展开和审查快照只含所选章节；删改仍被引用的章节 ID 会报错，可先调整关联。

页面将契约显示为章节堆栈，从所选章节连线到任务；点击标题看全文、点击章节看该节，右上角可收起或展开。收起时连线汇到标题，展开后恢复章节位置。

## Reference 条目

每条为代码/脚本路径、正整数行号、符号名和一行用途说明；说明最多 30 个 Unicode 字符，其余字段不计入。行号辅助定位，符号名应对移动。条目按需登记，不要求每个任务都交付 reference，也不另写参考 Markdown。复杂约束放 contract。

```text
CLI 'task[T-0012].reference' add --path src/payment.ts --line 86 --symbol commitPayment --summary "付款预览与提交共用入口"
CLI 'task[T-0013].reference' attach --id R-0001
CLI 'contract[C-0001].reference' attach --id R-0001
CLI 'reference[R-0001]' update --path src/payment.ts --line 92 --symbol commitPayment --summary "付款预览与提交共用入口"
```

路径相对项目根，可显式使用另一 worktree 的绝对代码路径；工具只存入口，不复制源码。相同路径和符号复用 ID，修改共享条目用 update；解除绑定用 remove。后继自动取得自身、直接前置及适用 gate 成员的条目，并合并已绑定 contract 的条目，同 ID 只出现一次。旧文件式 reference 继续可读，新 CLI 登记只接受条目。

## 一次登记已定决策

仅对需要独立审计的已定公共决定使用；普通实施取舍仍按 task-take 记短日志。

```text
CLI decision record --key material-policy-v1 --graph G-001 --title "材料许可规则" --text "<决定、取舍与当前契约正文>" --task T-0012 --task T-0013
```

一次事务保存正文、创建并完成 decision task、冻结同一正文作为交付证据、将消费者关联到 contract，最后刷新一次视图。已有契约加 `--contract C-0001`；大正文可用 `--file`。历史明确这是已定决策登记，不代表实施、测试或用户验收。消费者状态与执行依赖不变。

同一 key 和输入重试返回已有 ID，不重复建任务或追加历史；修改决定使用新 key。状态事务失败全量回滚。`saved: true` 且 `view.status: failed` 表示已保存但页面刷新失败，单独执行 `CLI . build`；不要另用新 key 重建。contract/reference 写入采用同样的回执。此处的重试识别不构成任务放行指纹校验。
