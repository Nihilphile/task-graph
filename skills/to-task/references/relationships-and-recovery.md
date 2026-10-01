# 复杂关系与恢复

创建父子关系或局部完成点，读 [关系操作](../../../references/operations/relationships.md)；跨图/parent_task 批次、稳定 key 与重试，读 [创建计划](../../../references/operations/planning.md)；修改旧任务，读 [维护](../../../references/operations/maintenance.md)。

图创建中断时先查询 project.yaml、已保存回执与现有 key，核实原图后继续。历史 plan.json 是创建请求，当前状态以 CLI 查询为准。GitHub pending 的恢复见 [同步](../../../references/github-sync.md)。
