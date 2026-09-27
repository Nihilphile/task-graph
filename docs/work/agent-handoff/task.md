# 按需交接与附件用途

用户反馈 show --handoff 聚合大量报告、日志，混入项目排除的工具反馈。context 已能提供地址，但原 show 仍返回附件正文，start 自动快照也复用旧聚合。

目标：默认代理查询提供事实和索引，正文显式按类别或路径展开；展开前可预览体量；附件支持 audience user，仅供人阅读，代理索引/交接排除，已有附件可补标。来源 source_task、read_path、live/snapshot 保留。HTML 继续供人审计。

范围：task-graph CLI、共享文件索引/交接生成、文档与 to-task/task-take 入口。保护现有未提交修改。无需读取 F:/AI_project/The-Game/unity-try 的附件正文，也不修改该项目源记录。用隔离夹具验证实现报告与用户反馈并存、快照、多参考、路径过滤、旧自动快照的行为。

交付：源码、针对性及必要回归验证、用法与兼容变化说明。未授权提交、推送或发布真实 GitHub issue。
