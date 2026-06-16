## Context

`web-litegraph/index_1.html` 基于 `litegraph.js@0.7.18`（CDN）实现一个可视化节点图编辑器。LiteGraph 的核心执行模型是**同步**的：`graph.runStep()` 按拓扑顺序逐个调用节点的 `onExecute()`，不会 `await` 返回值。

当前实现存在多处与该模型冲突的问题，导致默认图（2 个常量 → 数学运算 → 监视器）无法正常计算并展示结果 `2`：

1. **JSON 默认图数据与节点代码定义不一致**：`json/index_1.js` 中每个节点都带 `onTrigger` 输入 slot 和 `onExecuted` 输出 slot，但代码注册的 4 种节点（StartNode/ConstNode/MathNode/WatchNode）并未定义这些 slots；且所有节点 `mode:3`（Never）表示永不执行。
2. **`MathNode.onExecute` 为 async 且内含 `setTimeout 1500ms`**：返回的 Promise 不会被 `runStep` 等待，导致下游监视器在当帧拿到 `undefined`。
3. **`highlight` 插件用 async 函数包装 `onExecute`**：进一步放大上述问题，且仅在 `loadGraph` 时包装一次，运行时新增节点不会被包装。
4. **`runStep()` 依赖 `graph.startNode`**：但加载默认图时通过 `graph._nodes.filter(node => node.title === '开始节点')` 解析得到数组，且默认 JSON 中并不包含开始节点，导致 `graph.startNode[0].onExecute()` 报错。

## Goals / Non-Goals

**Goals:**
- 默认图加载后，点「启动图形」能通过自动拓扑执行让监视器正确显示 `2`。
- 默认图加载后，点「开始执行」能从开始节点（若存在）触发事件链路完成计算。
- 保留 `setTimeout` 延迟带来的执行高亮视觉效果（用户已确认）。
- 重新生成的 JSON 与代码节点定义完全一致，无多余 slots。
- 修复 `runStep()` 在无开始节点或解析逻辑错误时的报错。

**Non-Goals:**
- 不重构 `index.html`（旧版 demo）与 `demo.js`。
- 不新增节点类型（仅保留 开始/常量/数学/监视器 4 种）。
- 不改变页面整体布局（工具栏 + 侧边栏 + 画布）。
- 不引入构建工具或模块化改造（保持原生 `<script>` 引入方式）。
- 不修改 `litegraph.js` 库源码。

## Decisions

### Decision 1: 重新生成 `json/index_1.js` 默认图数据
**选择**：完全重写默认图 JSON，使其与代码注册的节点定义严格对齐。
**理由**：当前 JSON 中的 `onTrigger`/`onExecuted` slots 在代码节点中不存在，`configure` 后会产生悬空连接；`mode:3` 让节点永不执行。重写比修补更清晰。
**对齐内容**：
- 所有节点 `mode: 0`（Always，正常执行）
- 常量节点：仅 1 个 `value` 输出（type: number）
- 数学节点：2 个数据输入（A/B，type: number）+ 1 个 `onTrigger` 事件输入（type: `__EVENT__`）+ 1 个 `result` 输出
- 监视器节点：1 个 `value` 输入
- 开始节点：1 个 `start` 输出（type: `__EVENT__`），通过事件连接到数学节点的 `onTrigger`
- 拓扑：常量1.value → 数学.A，常量2.value → 数学.B，数学.result → 监视器.value，开始节点.start → 数学.onTrigger
**备选**：修改节点代码增加 slots 适配 JSON —— 被否决，会增加不必要的复杂度。

**修订（build 阶段，2026-06-16）**：验证发现「开始执行」按钮因开始节点事件未连接而无效。经用户确认选择「恢复事件连接」：数学节点保留 `onTrigger` 事件输入 slot，开始节点 `start` 输出通过事件连接到数学节点 `onTrigger`；`runStep()` 按钮在触发开始节点事件后追加一次拓扑执行，MathNode 延迟完成回调中自动执行一次拓扑让下游拿到延迟结果（同时修复「强制重新执行」task 4.1）。此修订使「开始执行」能真正驱动计算，对 c-2 多帧轮询方案无影响。

**二次修订（build 阶段事件流重构，2026-06-16）**：验证发现两个问题：(1) `runStep(num, do_not_catch_errors, limit)` 第三参数 `true` 被当成 `limit=1`，导致只执行 start 节点，常量/数学从未执行；(2) 事件流断在 math（math 无事件输出），且延迟完成时 `runStep` 连带重新执行 start 导致 start→math 连线乱闪。经用户要求"按 LiteGraph 官方最佳实践重做事件流"，参照内置 `events/delay` 节点模式（`LiteGraph.ACTION` 输入 + `onAction` 接收 + `LiteGraph.EVENT` 输出 + `triggerSlot` 传播）：
- StartNode `mode` 设为 `ON_TRIGGER`（3），拓扑循环 `runStep` 不再反复执行 start，消除延迟完成时 start→math 连线乱闪
- MathNode 新增 `out` 事件输出（slot index 1），`onTrigger` 改为标准 `onAction`；setTimeout 回调计算完成后 `triggerSlot(1)` 把事件传播给下游，让 math→watch 连线产生流动高亮动画
- WatchNode 新增 `onTrigger`（`LiteGraph.ACTION`）事件输入 + `onAction` 方法，事件驱动刷新显示
- JSON 新增 link5（math.out → watch.onTrigger，EVENT），start `mode` 改为 3，math/watch 增加对应 slot
- 效果：点击「开始执行」→ start→math 连线闪 → 1.5s 后 math→watch 连线闪，动画从开始逐级流转到输出
- 同时修复 MathNode 缓存变化检测未包含 `operation` 的 bug（切换 add/mul 时不重算），新增 `_lastOperation` 字段纳入检测键

### Decision 2: 修复 `runStep()` 的 `graph.startNode` 解析
**选择**：将 `graph.startNode` 统一解析为单个节点引用（而非数组），并在无开始节点时安全降级（仅刷新画布，不报错）。
**理由**：当前 `graph._nodes.filter(...)` 返回数组，访问 `[0]` 在空数组时报错；且事件触发执行模型应优雅处理图里没有开始节点的情况。
**备选**：移除「开始执行」按钮 —— 被否决，用户要求保留两种执行模型。

### Decision 3: 保留延迟高亮，但修复 async 破坏拓扑顺序的问题
**选择方向**（具体方案待 `/comet-design` brainstorming 确认）：在保留 `setTimeout` 视觉延迟的前提下，确保下游节点能拿到正确的最终计算结果。候选思路包括：
- (a) 节点内部缓存「上一轮已完成的结果」，下游读取缓存值；
- (b) 用 LiteGraph 的 action/事件 slot 显式驱动而非依赖自动拓扑；
- (c) 自定义异步执行队列替代 `graph.runStep`。
**理由**：用户明确要求保留延迟高亮视觉效果，但 LiteGraph 同步执行模型与 async onExecute 本质冲突，必须在 design 阶段深入权衡。
**备选**：完全去掉 async/setTimeout —— 被用户否决（要求保留延迟高亮）。

### Decision 4: highlight 插件覆盖新增节点
**选择**：确保插件的高亮包装逻辑能覆盖运行时通过侧边栏新增的节点（当前仅在 `loadGraph` 时包装一次）。
**理由**：验收场景要求「新增节点也能正常执行和高亮」。
**具体实现**：待 design 阶段确定（候选：在 `addNode` 时调用包装，或监听 graph 的 node-added 事件）。

## Risks / Trade-offs

- **[Risk] async onExecute 与同步拓扑执行的冲突** → 在 design 阶段通过 brainstorming 选定方案后再实现；若所有候选方案均无法兼顾，回退到「延迟仅用于高亮，计算本身同步」。
- **[Risk] LiteGraph 0.7.18 的 `runStep` 行为细节** → 实现时需通过实际运行验证，必要时查阅库源码确认 `doComputeCreation`、`execution_timer` 等内部行为。
- **[Trade-off] 重新生成 JSON 会丢失当前 JSON 中可能存在的其他实验性数据** → 当前 JSON 仅为演示拓扑，无业务数据，可接受。
- **[Trade-off] 保留延迟高亮会增加实现复杂度** → 用户已明确要求保留，接受此复杂度。

## Open Questions

1. **async 冲突的具体解决方案**：Decision 3 列出的 (a)/(b)/(c) 三个候选思路中选哪一个？需在 `/comet-design` 的 brainstorming 中深入讨论 LiteGraph 执行循环细节后确定。
2. **highlight 插件覆盖新增节点的具体机制**：是改 `addNode` 函数，还是用 LiteGraph 的 `onNodeAdded` 回调？需确认 0.7.18 是否暴露该回调。
3. **「强制重新执行」按钮的语义**：当前调用 `graph.runStep(0.1, false, true)`，在引入延迟高亮后是否需要调整参数以确保结果可见？
