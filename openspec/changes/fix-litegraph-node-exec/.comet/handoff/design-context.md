# Comet Design Handoff

- Change: fix-litegraph-node-exec
- Phase: design
- Mode: compact
- Context hash: 6b3cc22effc73968bd801dfd662750d188ffac2ec298ffad1f8d1b0bb9d008f4

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/fix-litegraph-node-exec/proposal.md

- Source: openspec/changes/fix-litegraph-node-exec/proposal.md
- Lines: 1-29
- SHA256: f1d8b3950450e3f394357eb1244e56925e573caf487a567ebfbe6e61565194eb

```md
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
```

## openspec/changes/fix-litegraph-node-exec/design.md

- Source: openspec/changes/fix-litegraph-node-exec/design.md
- Lines: 1-70
- SHA256: 69d7022bec858118610db44e120336a58ee58c488e43af30f967d57377aa35ce

```md
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
- 数学节点：2 个输入（A/B，type: number）+ 1 个 `result` 输出
- 监视器节点：1 个 `value` 输入
- 拓扑：常量1.value → 数学.A，常量2.value → 数学.B，数学.result → 监视器.value
**备选**：修改节点代码增加 slots 适配 JSON —— 被否决，会增加不必要的复杂度。

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
```

## openspec/changes/fix-litegraph-node-exec/tasks.md

- Source: openspec/changes/fix-litegraph-node-exec/tasks.md
- Lines: 1-31
- SHA256: 2d6180b78dd23e43b0c90ab0a74a9a9ae003b78092a24df0c0faa512e0dd6dcc

```md
## 1. 默认图数据修复

- [ ] 1.1 重新生成 `web-litegraph/json/index_1.js`，使所有节点 `mode` 为 `0`，去掉 `onTrigger` 输入与 `onExecuted` 输出等多余 slots
- [ ] 1.2 确保默认图拓扑为：常量1.value → 数学.A、常量2.value → 数学.B、数学.result → 监视器.value（两个常量值均为 1，数学 operation 为 add）
- [ ] 1.3 验证默认图加载后无悬空 slot、无控制台 slot 警告

## 2. 节点执行与控制函数修复

- [ ] 2.1 修复 `runStep()` 对 `graph.startNode` 的解析，统一为单节点引用，无开始节点时安全降级不报错
- [ ] 2.2 确认「启动图形」按钮触发的自动拓扑执行能让数据从常量流经数学到达监视器并显示 `2`
- [ ] 2.3 确认「开始执行」按钮在存在开始节点时能触发事件链路完成计算

## 3. 延迟高亮与拓扑顺序冲突解决（方案待 `/comet-design` brainstorming 确定）

- [ ] 3.1 在 `/comet-design` brainstorming 中确定 async onExecute + setTimeout 延迟与同步拓扑执行冲突的具体解决方案（候选：节点缓存上轮结果 / action 事件驱动 / 自定义异步队列）
- [ ] 3.2 在 `/comet-design` brainstorming 中确定 highlight 插件覆盖运行时新增节点的具体机制（候选：改 addNode / onNodeAdded 回调）
- [ ] 3.3 按确定方案实现：保留延迟高亮视觉效果，但下游节点能拿到上游最终正确结果
- [ ] 3.4 按确定方案实现：运行时新增节点能正常执行且被高亮插件覆盖

## 4. 强制重新执行验证

- [ ] 4.1 确认「强制重新执行」按钮在引入延迟高亮后仍能正确更新监视器结果

## 5. 验收场景验证

- [ ] 5.1 验证场景：启动图形后监视器显示 `value: 2`
- [ ] 5.2 验证场景：启动图形后节点依次呈现执行中/已执行高亮
- [ ] 5.3 验证场景：无开始节点时点击「开始执行」不报错
- [ ] 5.4 验证场景：延迟高亮下监视器仍拿到正确结果 `2`
- [ ] 5.5 验证场景：运行时新增节点能执行并被高亮
- [ ] 5.6 验证场景：强制重新执行后结果正确更新
```

## openspec/changes/fix-litegraph-node-exec/specs/litegraph-node-execution/spec.md

- Source: openspec/changes/fix-litegraph-node-exec/specs/litegraph-node-execution/spec.md
- Lines: 1-62
- SHA256: c66fa625738fc4181f1250b33fcd4a75a108d94729fd55be04838f6b2e42a519

```md
## ADDED Requirements

### Requirement: 默认图数据与节点定义一致
系统加载的默认图 JSON 数据（`json/index_1.js`）SHALL 与 `index_1.html` 中代码注册的 4 种节点（开始/常量/数学/监视器）的 slot 定义严格一致，不得包含代码中未定义的 slot（如 `onTrigger` 输入、`onExecuted` 输出），且所有节点 `mode` MUST 为 `0`（正常执行）。

#### Scenario: 默认图加载后无悬空 slot
- **WHEN** 页面加载并执行 `loadGraph()` 从 `Index_1_JsonData` 加载默认图
- **THEN** 所有节点的输入/输出 slot 与代码注册的定义一一对应，控制台无 slot 相关警告，无悬空连接

#### Scenario: 默认图节点均处于可执行状态
- **WHEN** 默认图加载完成
- **THEN** 常量节点、数学节点、监视器节点的 `mode` 均为 `0`，不会被 LiteGraph 跳过执行

### Requirement: 默认图拓扑为常量加法到监视器
默认图 SHALL 包含 2 个常量节点（值均为 `1`）、1 个数学运算节点（operation 为 `add`）、1 个监视器节点，且连接拓扑为：常量1.value → 数学.A、常量2.value → 数学.B、数学.result → 监视器.value。

#### Scenario: 默认图拓扑正确
- **WHEN** 默认图加载完成
- **THEN** 画布上呈现 2 个常量节点、1 个数学运算节点、1 个监视器节点，且连接关系为 常量→数学→监视器 的加法链路

### Requirement: 自动拓扑执行能完成计算
当用户点击「启动图形」按钮触发 `graph.start()` 后，系统 SHALL 通过 LiteGraph 的自动拓扑执行让数据从常量节点流经数学节点到达监视器节点，监视器节点 MUST 显示计算结果 `2`。

#### Scenario: 启动图形后监视器显示加法结果
- **WHEN** 默认图加载完成，用户点击「启动图形」按钮，等待节点执行完成
- **THEN** 监视器节点的 `value` 为 `2`，且在画布上渲染显示 `value: 2`

#### Scenario: 启动图形后节点依次高亮
- **WHEN** 默认图加载完成，用户点击「启动图形」按钮
- **THEN** 节点按执行顺序依次呈现「执行中」和「已执行」的高亮状态（具体视觉延迟由 design 阶段确定）

### Requirement: 事件触发执行能完成计算
当用户点击「开始执行」按钮时，系统 SHALL 从开始节点（若图中存在）触发事件链路完成计算；若图中不存在开始节点，系统 MUST 不报错并安全降级（仅刷新画布）。

#### Scenario: 存在开始节点时事件触发执行
- **WHEN** 默认图加载完成且图中存在开始节点，用户点击「开始执行」按钮
- **THEN** 从开始节点触发执行链路，最终监视器节点显示计算结果

#### Scenario: 不存在开始节点时不报错
- **WHEN** 默认图中不包含开始节点，用户点击「开始执行」按钮
- **THEN** 系统不抛出异常（不出现 `Cannot read properties of undefined` 等错误），画布正常刷新

### Requirement: 执行延迟高亮不破坏拓扑顺序
保留节点执行的延迟高亮视觉效果时，系统 MUST 确保下游节点能拿到上游节点的最终正确计算结果，不得因延迟导致下游节点读到 `undefined` 或旧值。具体实现机制由 design 阶段确定。

#### Scenario: 延迟高亮下监视器仍拿到正确结果
- **WHEN** 数学节点存在执行延迟（如 1500ms）和高亮，用户启动图形并等待执行完成
- **THEN** 监视器节点最终显示正确的加法结果 `2`，而非 `undefined`

### Requirement: 运行时新增节点可执行且可高亮
系统 SHALL 确保通过侧边栏在运行时新增的节点能正常执行且被高亮插件覆盖，不得出现「新增节点未被高亮包装」的情况。

#### Scenario: 新增节点执行并被高亮
- **WHEN** 用户从侧边栏点击添加一个常量节点，连线后点击启动图形
- **THEN** 新增的常量节点能正常输出值，并呈现执行高亮状态

### Requirement: 强制重新执行能更新结果
当用户点击「强制重新执行」按钮时，系统 SHALL 重新执行所有节点并更新监视器显示的结果。

#### Scenario: 强制重新执行后结果更新
- **WHEN** 默认图已加载并执行过一次，用户修改某常量节点的值后点击「强制重新执行」
- **THEN** 监视器节点显示基于新值的重新计算结果
```

