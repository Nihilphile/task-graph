# GitHub 自动同步

CLI 入口和项目路径规则见 [SKILL.md](../SKILL.md)。下面的 CLI 仍指 `node "<Skill目录>/dist/src/cli.js"`。

## 开启一次，继续正常使用

前提：机器安装 GitHub CLI，`gh auth status` 显示已登录 github.com，账号有目标仓库的 issue 写入权限。需要登录时由用户执行 `gh auth login`。本版本支持 github.com。

```text
CLI graph add --title "版本交付" --entry --gh --repo owner/repo --cwd "<项目根目录>" --json
```

已有图改用 `graph publish G-001 --repo owner/repo`。项目已关联 GitHub remote 时可省略 `--repo`。仓库无法推断会在创建图前报错；显式提供仓库时，即使暂时未联网，本地仍能创建图并显示待同步。

开启表示该图及后代任务的要求、领取信息、报告、日志和交接会发布到指定仓库。已有图开启时也会发布现有内容。按用户已有授权选择开启；普通本地建图不加开关。

之后照常使用任务命令，无须重复传 `--gh`，也无须让 Agent 自行编写 issue 或 comment。

## 对应关系

| 本地记录 | GitHub |
| --- | --- |
| 入口图 | 总 issue，列出任务和完成数量 |
| 任务 | 所在图容器下的原生子 issue |
| 任务的子图 | 复用该父任务 issue，子图任务成为它的子 issue |
| 完全依赖数组 | 原生 blocked-by 依赖，支持多个前置任务 |
| 命名完成点依赖 | 展开为该完成点 requires 中的子任务 issue |
| 摘要、完整要求、状态、领取、人工阻塞 | 更新 issue 标题及工具管理的正文区 |
| task log | 逐条评论；启用此版本后记录的日志保留原文用于补发 |
| report / handoff attach、自动交接 | 按快照发布评论；同一文件不同版本分别保留 |
| 独立 log attach | 内容变化后发布新版本评论 |
| reference attach | issue 正文列出文件索引、读取方式和可选摘要；参考文件正文不自动发评论 |
| complete / cancel / reopen | 完成或取消时关闭 issue，重新打开时恢复 open |

入口图至少有一个直属任务，且全部 done/cancelled 后自动关闭；有任务恢复执行或新增待办时重新打开。复合父任务仍须显式 complete。包含取消任务的入口图使用 not_planned 关闭原因。人工阻塞和 ready/in_progress 见正文；Agent 的会话 ID 不映射为 GitHub assignee。

所有报告和待发评论成功发送后才关闭本轮完成的 issue。原生关系调用失败也会保留 pending，修复权限或 GitHub 的关系限制后重试。

## 文件内容与版本

Markdown/text、JSON/YAML/CSV、文本日志按原文发布。较长报告分成多条评论，较长任务要求放在注明版本的评论里。报告和交接读取冻结的快照，修改原始文件不改动已交付版本。

上述正文评论规则适用于 report/log/handoff。reference 用于后继定位本地资料，只同步索引和 summary；引用代码文件不会因登记 reference 而自动作为评论发布。附件 summary 会显示在新发布的对应报告/日志/交接评论中。

PDF、图片等二进制附件发布文件名和 SHA-256 元数据；文件仍保存在本地。不会自动上传附件、commit 或 push。Markdown 内本地图片及相对链接也不会自动上传到 GitHub；GitHub 阅读需另有可访问的链接。离线 HTML 保留现有文件读取能力。

普通 `task output add` 只在正文列出产物路径，允许文件尚未创建。要发布报告正文，使用 `task report attach`。

## 同步时机和失败恢复

- 成功的 CLI 修改、`build`、`github sync` 会执行一次同步；本地事务先提交，网络操作使用独立锁。
- `task list/show`、`validate`、帮助和 Skill 校验不发布、不重试。
- 直接编辑要求或日志文件后，用 `build` 发布；没有后台文件监听服务。
- 网络或 API 错误保留本地成功，JSON 返回 `github.status: pending` 和错误原因。HTML 侧栏显示待同步，已有 issue 链接仍可用。
- 下一次修改/build 会重试，也可显式 `github sync`。连续失败时修复错误原因，避免反复重跑同一创建任务命令。
- issue/comment 带稳定标记，响应丢失时先查询已有记录再补发。已发评论不会重复发送；移除本地附件不会删除历史远程评论，已经进入队列的评论仍会补发。
- 同步期间有并发本地修改时，完成当前快照后保留 pending，下一次同步再发布新内容。

`.task-graph/github-sync.json` 保存项目身份、远程映射、待发内容和版本摘要，应与任务源文件一起保留和备份。它不是可删除后重建的缓存。文件损坏时停止远程写入，恢复原文件后重试；不要通过删除状态文件来清除错误。独立锁为 `.task-graph/github-sync.lock`；异常留下空锁时，确认没有同步进程后可移除该锁文件。正常死进程锁自动回收。

## 编辑边界

本地 Task Graph 是任务数据来源。GitHub 人工评论和正文管理区之外的补充文字保留；管理区内的内容、标题、状态以后续本地数据为准。保持正文内的 task-graph 标记完整。GitHub 修改不会反向更新本地。

工具只移除它自己创建的依赖边；人工额外添加的 GitHub 依赖保留。子 issue 的父子归属按本地图关系维护。已启用图的仓库绑定不可通过 publish 改到其他仓库。

使用 [GitHub 子 issue API](https://docs.github.com/en/rest/issues/sub-issues)、[依赖 API](https://docs.github.com/en/rest/issues/issue-dependencies) 和 [评论 API](https://docs.github.com/en/rest/issues/comments)。
