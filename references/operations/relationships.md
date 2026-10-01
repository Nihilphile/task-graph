# 子图、依赖与完成点

本文的 `CLI` 表示 `node "<工具根目录>/dist/src/cli.js"`；所有调用带目标项目 `--cwd`，结构化输出加 `--json`。入口未确定时读 [准备与定位](bootstrap.md)。

### 何时拆子图

一项大任务需要多项内部工作时，将内部任务放在它的子图中。父任务仍代表最终交付；子图归属和执行依赖是两种关系，创建子任务不会自动让兄弟任务互相等待。

假设 T-0001 是尚未完成的“交付功能”父任务，要求文件已准备好：

```text
CLI task add --parent-task T-0001 --summary "实现接口" --content doc/tasks/api.md --cwd "<项目根目录>" --json
CLI task add --parent-task T-0001 --summary "补齐文档" --content doc/tasks/docs.md --cwd "<项目根目录>" --json
```

首个子任务自动创建子图，以后复用；所有新增子任务默认加入父任务完成目标。假设返回子任务 ID 分别为 T-0002、T-0003：

- 父任务的 `completion_requires` 默认包含两者；两者 done 后才允许 complete T-0001。
- 父任务不会自动变成 done，需主控或执行者显式完成。
- done/cancelled 父任务不能直接增加子任务：done 先 reopen；cancelled 为终态，应建立替代任务。
- 特殊情况下可用 `'task[T-0001]' set-completion --requires T-0002 --requires T-0003` **替换**完整目标列表；它不是追加操作。

### 只等其中一部分：gate

假设外层“集成验证”任务 T-0004 只需接口完成，不必等待文档。给父任务公开名为 api-ready 的完成点：

```text
CLI 'task[T-0001]' expose-gate --name api-ready --requires T-0002 --cwd "<项目根目录>" --json
CLI 'task[T-0004].dependency' add T-0001 --gate api-ready --cwd "<项目根目录>" --json
```

gate 是主控给一组子任务起的名称，名称在该父任务内唯一；组内任务全部 done 后，这条部分依赖就满足，即使父任务仍在执行中。外层通过父任务加 gate 访问进度，不直接依赖内部子任务。

普通完整依赖用 `'task[T-0004].dependency' add T-0001`。同一条关系保存在后继 T-0004 的 depends_on 中，前置任务无需再记录反向关系。

### 同批创建父任务、子任务与 gate

另一个独立计划示例；先准备三个 content 文件，使用项目已有入口图：

```json
{
  "graph": "G-001",
  "tasks": [
    {
      "key": "delivery",
      "summary": "交付功能",
      "content": "doc/tasks/delivery.md",
      "completion_requires": ["@api"],
      "exposes": { "api-ready": { "requires": ["@api"] } }
    },
    {
      "key": "api",
      "summary": "实现接口",
      "parent_task": "@delivery",
      "content": "doc/tasks/api.md"
    },
    {
      "key": "integration",
      "summary": "集成验证",
      "content": "doc/tasks/integration.md",
      "depends_on": ["@delivery:api-ready"]
    }
  ]
}
```

parent_task 优先决定子任务归属，计划顶层 graph 不把它移回入口图。工具先分配 ID，再解析引用，最后统一校验关系。

## 调整现有依赖

在后继的 `.dependency add <前置ID>` / `.dependency remove <前置ID>` 操作；需要局部依赖时指定 `--gate`。循环关系会被拒绝。改完查询受影响任务的 readiness。
