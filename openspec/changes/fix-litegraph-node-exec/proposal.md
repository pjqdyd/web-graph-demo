## Why

`web-litegraph/index_1.html` 的默认节点图（2 个常量 → 数学运算 → 监视器）当前无法正常执行并展示计算结果。原因包括：JSON 默认图中所有节点被设为 `mode:3`（永不执行）、JSON 中的节点 slots（`onTrigger`/`onExecuted`）与代码注册的节点定义不一致、`MathNode.onExecute` 使用 `async + setTimeout 1500ms` 破坏了 LiteGraph 的同步拓扑执行顺序、以及 `runStep()` 依赖的 `graph.startNode` 在加载默认图时未正确解析。这导致核心演示场景（常量加法 → 监视器显示 `2`）完全不可用。

## What Changes

- 重新生成 `json/index_1.js` 默认图数据：去掉与代码节点定义不一致的多余 slots（`onTrigger` 输入、`onExecuted` 输出），所有节点 `mode` 改为 `0`（正常执行），保持 2 个常量 → 数学运算(add) → 监视器 的默认拓扑。
- 修复 `index_1.html` 中节点的执行逻辑，使「自动拓扑执行」（`graph.start()`）与「事件触发执行」（从开始节点 `runStep`）两种模型都能正确驱动数据流。
- 解决 `MathNode.onExecute` 的 `async + setTimeout` 与同步拓扑执行的冲突，保留延迟高亮的视觉效果但不破坏拓扑顺序（具体方案在 design 阶段确定）。
- 修复 `highlight` 插件在 async 包装下破坏执行顺序的问题，并确保新增节点也能被正确高亮包装。
- 修正 `runStep()` 对 `graph.startNode` 的解析逻辑，避免加载默认图时报错。

## Capabilities

### New Capabilities
- `litegraph-node-execution`: `index_1.html` 页面的节点图执行能力，覆盖默认图加载、自动拓扑执行、事件触发执行、节点执行高亮，确保常量/数学运算/监视器节点能正确完成数据流计算并展示结果。

### Modified Capabilities
<!-- 项目 openspec/specs/ 当前为空，无已有 capability 需要修改 -->

## Impact

- **代码文件**：
  - `web-litegraph/index_1.html`（节点定义、控制函数、执行流程）
  - `web-litegraph/json/index_1.js`（默认图 JSON 数据）
  - `web-litegraph/plugin/highlight.js`（执行高亮插件，可能调整）
- **依赖**：`litegraph.js@0.7.18`（CDN 引入，不修改库本身）
- **不影响**：`web-litegraph/index.html`（旧版 demo）、`web-litegraph/demo.js`、其他 web-* 模块
- **运行时**：纯前端，无后端/数据库影响
