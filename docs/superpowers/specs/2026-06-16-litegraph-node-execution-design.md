---
comet_change: fix-litegraph-node-exec
role: technical-design
canonical_spec: openspec
---

# Design: LiteGraph 节点图执行修复（c-2 多帧轮询方案）

## 背景与动机

`web-litegraph/index_1.html` 的默认节点图（2 个常量 → 数学运算 → 监视器）当前无法正常执行。根本原因是 LiteGraph 0.7.18 的同步执行模型（`runStep` 不 `await` 节点 `onExecute`）与原实现的 `async onExecute + setTimeout` 冲突，叠加 JSON 数据与节点定义不一致、`runStep` 解析报错等问题。

详细背景见 `openspec/changes/fix-litegraph-node-exec/proposal.md` 与 `design.md`。

## 总体方案：c-2 多帧轮询 + 节点延迟缓存 + 节点自管理高亮

保留 LiteGraph 的 `graph.start()` 自动 RAF 渲染循环（每帧调用 `runStep`），在 MathNode 内部实现延迟计算状态机。计算真的延迟（1500ms 后输出结果），通过多帧自然推进让下游节点在延迟结束后拿到正确值。

### 为什么选 c-2 而非 c-1（自定义异步队列）

- c-1 需停掉 LiteGraph 自动循环、手动驱动渲染，改动大且两种执行模型难统一
- c-2 保留渲染循环，WatchNode 的 `onDrawBackground` 正常工作，两种执行模型（启动图形 / 开始执行）都走同一套节点机制
- c-2 符合 LiteGraph 多帧执行的设计哲学

## 数据流与状态机

### 执行时间线

```
t=0ms     帧N:    常量1/2 输出 1
                  数学节点 onExecute: 检测输入变化 → 启动 setTimeout(1500)
                  数学: _computing=true, setOutputData(0, null), 高亮=executing(黄)
                  监视器: getInputData(0) = null → 显示空

t=1500ms  帧N+90: setTimeout 回调触发
                  数学: _cachedResult = 1+1 = 2
                  _computing=false
                  setOutputData(0, 2)
                  高亮=executed(绿)
                  setDirtyCanvas(true, true) → 触发下一帧重算

t≈1516ms  帧N+91: 监视器: getInputData(0) = 2 → 显示 value: 2
                  高亮=executed
```

### MathNode 延迟状态机

MathNode 维护四个内部状态：

| 状态字段 | 用途 |
|---------|------|
| `_lastInputs` | 记录上次执行的输入 `[A, B]`，用于变化检测 |
| `_pendingTimer` | setTimeout 句柄，可清除 |
| `_computing` | 是否正在延迟计算中 |
| `_cachedResult` | 最近一次完成的计算结果 |

`onExecute()`（同步，每帧被 `runStep` 调用）逻辑：

```
读取 A = getInputData(0), B = getInputData(1)

if A 或 B 为 null:
    setOutputData(0, null)
    return

if [A, B] !== _lastInputs (输入变化 或 首次执行):
    _lastInputs = [A, B]
    _computing = true
    setNodeHighlight(this, 'executing')
    setOutputData(0, null)              // 延迟期间下游显示空
    clearTimeout(_pendingTimer)
    _pendingTimer = setTimeout(() => {
        _cachedResult = compute(A, B)   // 按 operation 计算
        _computing = false
        setOutputData(0, _cachedResult)
        setNodeHighlight(this, 'executed')
        this.setDirtyCanvas(true, true) // 触发下游下一帧重算
    }, 1500)

else if _computing:
    setOutputData(0, null)              // 计算中保持空

else:
    setOutputData(0, _cachedResult)     // 保持已完成结果
```

**边界处理**：
- 输入为 null（未连接/上游未输出）：setOutputData(null)，不启动计时
- 输入未变且已完成：持续输出 cachedResult（幂等，不重复触发计时）
- 输入变化重置：clearTimeout 防止旧回调污染新结果

## 组件设计

### 1. JSON 默认图数据（`json/index_1.js`）

重新生成，与代码节点定义严格对齐：

- 所有节点 `mode: 0`（正常执行）
- 常量节点：仅 1 个 `value` 输出（type: `number`），`properties.value: 1`
- 数学节点：2 输入（A/B, `number`）+ 1 输出（result, `number`），`properties.operation: "add"`
- 监视器节点：1 输入（value, 空类型）
- links：常量1.value→数学.A，常量2.value→数学.B，数学.result→监视器.value

### 2. 节点定义（`index_1.html`）

| 节点 | 行为 |
|------|------|
| **ConstNode** | 同步：`setOutputData(0, value)` + `setNodeHighlight(this, 'executed')` |
| **MathNode** | 延迟状态机（见上） |
| **WatchNode** | `onExecute`: `this.value = getInputData(0)` + 高亮 executed；`onDrawBackground`: value 为 null 显示空，否则显示值 |
| **StartNode** | `onExecute`: `triggerSlot(0)` + 高亮 executed |

### 3. highlight 插件（`plugin/highlight.js`）

从 async 包装模式降级为纯工具函数：

```js
function setNodeHighlight(node, state) {
    const styles = {
        executing: { color: "#796e4f", boxColor: "#efc083" },
        executed:  { color: "#456745", boxColor: "#91ef8d" }
    };
    const style = styles[state];
    if (!style) return;
    node.color = style.color;
    node.boxcolor = style.boxColor;
    node.setDirtyCanvas(true);
}
```

- 移除原 `CustomLiteGraphHighlightPlugin` 的 async 包装逻辑
- 节点在自身状态变化时调用 `setNodeHighlight`
- 运行时新增节点天然支持（高亮逻辑在节点 onExecute 内）

### 4. 控制函数（`index_1.html`）

| 函数 | 修复内容 |
|------|---------|
| `loadGraph()` | `graph.startNode` 按 `type === "basic/start"` 查找单节点（非数组） |
| `addNode(type)` | 若 type 为 `basic/start`，设置 `graph.startNode` 为该节点单引用 |
| `runStep()` | `if (graph.startNode) graph.startNode.onExecute()`；无开始节点时仅刷新画布不报错 |
| `forceRunStep()` | 保留 `graph.runStep(0.1, false, true)`；靠 MathNode 输入变化检测实现重算 |

## 错误处理

- **无开始节点时点「开始执行」**：`runStep` 检查 `graph.startNode` 为 falsy，跳过触发，仅 `setDirtyCanvas`，不抛异常
- **节点未连接**：`getInputData` 返回 null，MathNode 输出 null，WatchNode 显示空，不报错
- **重复点击启动**：`graph.start()` 幂等，LiteGraph 内部处理

## 测试策略

纯前端项目无测试框架，采用手动浏览器验证，覆盖 `specs/litegraph-node-execution/spec.md` 的 7 个 Requirement：

1. 默认图加载无悬空 slot、mode=0
2. 默认图拓扑正确（2常量+数学+监视器）
3. 启动图形 → 1.5s 后监视器显示 `value: 2`
4. 启动图形 → 节点依次高亮（黄→绿）
5. 无开始节点点「开始执行」不报错
6. 延迟期间监视器显示空，完成后显示 2
7. 新增节点能执行且高亮
8. 强制重新执行后结果更新

验证方式：浏览器打开 `index_1.html`，操作工具栏按钮，观察画布与控制台。

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| MathNode 输入变化检测的边界（null、未变、首次） | 严格区分三种分支：输入变化→重算、computing→保持null、已完成→保持结果 |
| `setDirtyCanvas` 后下游能否在下一帧读到新值 | LiteGraph 的 `runStep` 每帧重算所有 mode=0 节点，setDirtyCanvas 触发重绘+重算，时序可靠 |
| 常量节点值修改后能否触发 MathNode 重算 | MathNode 的 `_lastInputs` 变化检测会捕获 getInputData 的新值，自动启动新一轮延迟 |

## 非目标

- 不重构 `index.html`（旧版 demo）、`demo.js`
- 不新增节点类型
- 不改变页面布局
- 不引入构建工具或模块化
- 不修改 `litegraph.js` 库源码
