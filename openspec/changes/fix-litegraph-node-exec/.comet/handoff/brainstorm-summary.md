# Brainstorm Summary

- Change: fix-litegraph-node-exec
- Date: 2026-06-16

## 确认的技术方案

### 总体方案：c-2 多帧轮询 + 节点延迟缓存 + 节点自管理高亮

保留 LiteGraph 的 `graph.start()` 自动 RAF 渲染循环（每帧 `runStep`），MathNode 内部实现延迟计算状态机，利用多帧自然推进让下游在延迟结束后拿到正确结果。

### 已确认决策

1. **延迟语义**：计算真的延迟（MathNode 1500ms 后才输出结果），下游要等
2. **异步实现路径**：c-2 多帧轮询（非 c-1 自定义队列）
3. **高亮机制**：节点自管理状态，highlight.js 降级为工具函数 `setNodeHighlight(node, state)`，移除 async 包装
4. **延迟期间下游显示**：null/空（能看到"等待计算"过程）

### 节点行为设计

- **ConstNode（常量，无延迟）**：onExecute 同步 `setOutputData(0, value)`，调用 `setNodeHighlight(this, 'executed')`
- **MathNode（数学，延迟状态机）**：
  - onExecute 同步检测输入变化
  - 输入变化 → 启动 setTimeout(1500)，`_computing=true`，`setOutputData(0, null)`，高亮 executing
  - setTimeout 回调 → 计算结果存 `_cachedResult`，`setOutputData(0, result)`，`_computing=false`，高亮 executed，`setDirtyCanvas(true)` 触发下游重算
  - computing 期间保持 null；完成后保持 cachedResult
- **WatchNode（监视器，无延迟）**：onExecute 读 `getInputData(0)`，onDrawBackground 显示（null 显示空）
- **StartNode（开始，无延迟）**：onExecute triggerSlot(0)

### JSON 重新生成
- 所有节点 mode: 0
- 去掉 onTrigger/onExecuted 多余 slots
- 拓扑：常量1(value:1)→数学.A，常量2(value:1)→数学.B，数学.result→监视器.value

### runStep 修复
- graph.startNode 统一为单节点引用（addNode 时设置，loadGraph 时按 type=basic/start 查找）
- 无开始节点时安全降级不报错

### forceRunStep 保留
- 保留 `graph.runStep(0.1, false, true)`
- 靠 MathNode 输入变化检测实现重算（常量值改了自动触发新一轮延迟计算）

## 关键取舍与风险

- **[Trade-off] 多帧轮询下延迟期间下游显示空**：用户体验上能看到"等待→结果"过程，符合演示意图
- **[Risk] MathNode 输入变化检测的边界**：需正确处理首次执行、null 输入、值未变等情况，避免无限触发 setTimeout
- **[Risk] setDirtyCanvas 触发下游重算的时序**：需确保 setTimeout 回调后下一帧 runStep 能让 WatchNode 读到新值
- **[Trade-off] highlight 从插件包装改为节点自调用**：节点与高亮有耦合，但换来新增节点天然支持

## 测试策略

- 纯前端无测试框架，采用手动浏览器验证
- 按 specs/litegraph-node-execution/spec.md 的 7 个 Requirement 逐项验证
- 重点验证：启动后 1.5s 监视器显示 2、无开始节点不报错、新增节点高亮、强制重新执行更新结果

## Spec Patch

无。现有 delta spec 的 7 个 Requirement 已完整覆盖本方案，无需补充验收场景或修改范围。
