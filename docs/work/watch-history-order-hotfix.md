# 旧版本通知校验修复

日期：2026-09-28。仅修复当前安装使用的旧版本，未合并 auto-review 分支。

## 原因与修复

通知生成时直接哈希内存中的 history；任务 YAML 保存时会排序 extra 字段。含 result 或 reason 的完成记录在重新读取后排列改变，导致发送前校验误判历史缺失。任务结果和报告本身已保存。

`src/core/watch.ts` 现在以排序后的完整历史内容生成和校验 ID。兼容旧事件时只重建旧生命周期明确使用的 `from/to/result/reason` 顺序，仍校验任务 ID、历史位置、事件、时间、actor 与全部字段值，不跳过完整性检查。旧事件的 ID、消息和投递记录保持不变；paused 不会因升级自动发送。

## 验证

新增回归先在旧实现失败，再在修复后通过：

- 普通完成、显式 pass、reject，分别覆盖有/无 reason；重复运行不重复投递。
- 旧事件保留 ID，paused 须显式 retry 后投递。
- 修改历史证据仍暂停；原有历史缺失、uncertain、进程恢复及订阅测试继续通过。

执行 `npm run build`，随后运行：

```text
node --test --test-isolation=none dist/tests/graph-watch.test.js dist/tests/us-009-lifecycle.test.js dist/tests/dynamic-planning.test.js
```

19/19 通过。使用临时项目和测试适配器，没有向真实 Desktop 会话发送测试消息。

## 已定位事件

项目 `F:/AI_project/The-Game/unity-try`：G-014 的 T-0103 在 2026-09-28 07:07:16 +08:00 登记 reject，通过 G-013 的有效订阅生成事件。检查时该事件 paused、attempts=0，校验失败的原因确认为上述字段顺序问题。

本次未修改该项目的任务或订阅数据，未重发通知。需要补发时使用订阅所属图 G-013：

```powershell
node 'C:/Users/Dreamjiao/.agents/skills/task-graph/dist/src/cli.js' 'graph[G-013].watch' retry d593e65a4d741ccf663bc60c15445d4093d01e247cb823c701d1bb12d8b4e93e --cwd 'F:/AI_project/The-Game/unity-try' --json
```

该命令会启动实际投递；`accepted` 仅表示 Desktop 接收队列回执，不证明主控已经阅读。若事件后续变为 uncertain，沿用既有核查流程，不自动重复发送。

当前旧工作区已有大量修改及未跟踪的功能文件；本修复保留其现状，没有为了提交补丁一并收录其他工作。修改范围为 watch 实现、对应测试和本记录，dist 已重新构建。
