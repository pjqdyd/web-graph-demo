---
change: fix-litegraph-node-exec
design-doc: docs/superpowers/specs/2026-06-16-litegraph-node-execution-design.md
base-ref: dbe02d5337d8046a01b779620020d7717cb464c1
---

# LiteGraph 节点图执行修复 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `web-litegraph/index_1.html` 默认节点图（2 常量 → 数学运算 → 监视器）无法执行的问题，使点击「启动图形」后监视器在约 1.5s 后显示 `value: 2`，并保留延迟高亮视觉效果。

**Architecture:** 采用 Design Doc 的 **c-2 多帧轮询方案**。保留 LiteGraph 0.7.18 的 `graph.start()` 自动 RAF 渲染循环（每帧调用 `runStep`），将 MathNode 改造为**同步 onExecute + 内部 setTimeout 延迟状态机**，通过多帧自然推进让下游节点在延迟结束后拿到正确值。高亮逻辑从「插件包装 onExecute」降级为「节点自管理工具函数」，运行时新增节点天然支持。

**Tech Stack:** 纯前端项目，litegraph.js 0.7.18 通过 CDN 引入，无构建工具、无模块化、无测试框架。验证方式为**手动浏览器验证**（TDD 不适用）。

**Design Doc:** [2026-06-16-litegraph-node-execution-design.md](file:///Users/zcy/pjqdyd/web-graph/docs/superpowers/specs/2026-06-16-litegraph-node-execution-design.md)

**Spec:** [litegraph-node-execution/spec.md](file:///Users/zcy/pjqdyd/web-graph/openspec/changes/fix-litegraph-node-exec/specs/litegraph-node-execution/spec.md)

---

## 关键设计决策（来自 Design Doc，实施时不得偏离）

1. **延迟语义**：MathNode 的 `onExecute` 必须是**同步函数**（不能 `async`），否则 LiteGraph 的 `runStep` 不会 `await`，下游会读到 `undefined`。延迟通过 `setTimeout(1500)` 在回调中 `setOutputData` + `setDirtyCanvas(true, true)` 实现，靠下一帧 `runStep` 把结果推给下游。
2. **输入变化检测用值比较**：Design Doc 伪代码写的是 `[A, B] !== _lastInputs`，但在 JS 中每次 `[A, B]` 都是新数组，引用永远不等，会导致每帧重复触发延迟。实施时必须用**元素值比较**（`_lastInputs[0] !== A || _lastInputs[1] !== B`）实现「输入变化」语义。
3. **默认图不含开始节点**：Design Doc 的 JSON 重新生成只列了常量/数学/监视器三类节点与 3 条数据 link，无事件链路；Spec Requirement 4 的「不存在开始节点时不报错」场景即以默认图为验证对象。因此目标 JSON 移除 `basic/start` 节点与所有事件 link。
4. **不删除既有注释**：修改历史代码时保留原有注释（如 WatchNode 的 `console.log`、`显示监控的值` 注释），仅按 Design Doc 增补新逻辑。

## File Structure

| 文件 | 责任 | 本计划改动 |
|------|------|-----------|
| `web-litegraph/plugin/highlight.js` | 节点高亮工具函数 | **重写**：移除 `CustomLiteGraphHighlightPlugin` async 包装，新增 `setNodeHighlight(node, state)` 纯工具函数 |
| `web-litegraph/json/index_1.js` | 默认图 JSON 数据（全局变量 `Index_1_JsonData`） | **重新生成**：所有节点 `mode:0`，移除多余 slots 与事件 link |
| `web-litegraph/index_1.html` | 节点定义 + 控制函数 | **修改 4 个节点类 + 3 个控制函数** |

执行顺序按依赖关系：先 `highlight.js`（基础设施）→ `index_1.js`（数据层）→ `index_1.html` 节点定义 → `index_1.html` 控制函数 → 端到端验证。

---

## Task 1: highlight.js 降级为工具函数

**Files:**
- Modify: `web-litegraph/plugin/highlight.js` (整文件重写)

**对应 Design Doc:** §3 highlight 插件
**对应 Spec:** Requirement「运行时新增节点可执行且可高亮」

- [ ] **Step 1: 重写 plugin/highlight.js**

将原 `CustomLiteGraphHighlightPlugin`（async 包装 onExecute）替换为纯工具函数 `setNodeHighlight`。节点在自身状态变化时调用，运行时新增节点天然支持。

完整目标文件内容：

```javascript
// 节点执行高亮工具函数
// 由各节点在自身 onExecute 状态变化时显式调用
// 相比原 async 包装模式，运行时新增节点无需重新包装即可高亮
function setNodeHighlight(node, state) {
    const styles = {
        executing: { color: "#796e4f", boxColor: "#efc083" },
        executed: { color: "#456745", boxColor: "#91ef8d" }
    };
    const style = styles[state];
    if (!style) return;
    node.color = style.color;
    node.boxcolor = style.boxColor;
    node.setDirtyCanvas(true);
}
```

- [ ] **Step 2: 手动浏览器验证（基础加载）**

操作：
1. 浏览器打开 `web-litegraph/index_1.html`
2. 打开 DevTools Console

预期：页面正常加载，**Console 不出现 `CustomLiteGraphHighlightPlugin is not defined` 之外的新错误**（此时 `loadGraph()` 仍引用旧函数，预期报 `CustomLiteGraphHighlightPlugin is not defined`，属本任务过渡态，Task 7 会移除该调用）。

> 注：本任务单独验证意义有限，关键验证在 Task 7 移除 `loadGraph` 中的插件调用后。此处仅确认文件语法无误、`setNodeHighlight` 已暴露为全局函数。可在 Console 输入 `typeof setNodeHighlight`，预期输出 `"function"`。

- [ ] **Step 3: Commit**

```bash
git add web-litegraph/plugin/highlight.js
git commit -m "refactor(highlight): 降级为 setNodeHighlight 工具函数，支持节点自管理高亮"
```

---

## Task 2: 重新生成 JSON 默认图数据

**Files:**
- Modify: `web-litegraph/json/index_1.js` (整文件重写)

**对应 Design Doc:** §1 JSON 默认图数据
**对应 Spec:** Requirement「默认图数据与节点定义一致」「默认图拓扑为常量加法到监视器」

- [ ] **Step 1: 重写 json/index_1.js**

目标 JSON 对象（格式化展示，便于审查）：

```json
{
  "last_node_id": 6,
  "last_link_id": 3,
  "nodes": [
    {
      "id": 6, "type": "basic/start",
      "pos": [100, 250], "size": [140, 40],
      "flags": {}, "order": 0, "mode": 0,
      "outputs": [{"name": "start", "type": "__EVENT__", "links": null}],
      "title": "开始节点", "properties": {}
    },
    {
      "id": 2, "type": "basic/const",
      "pos": [325, 204], "size": [169.6, 46],
      "flags": {}, "order": 1, "mode": 0,
      "outputs": [{"name": "value", "type": "number", "links": [1], "slot_index": 0}],
      "title": "常量", "properties": {"value": 1}
    },
    {
      "id": 4, "type": "basic/const",
      "pos": [317, 303], "size": [169.6, 46],
      "flags": {}, "order": 2, "mode": 0,
      "outputs": [{"name": "value", "type": "number", "links": [2], "slot_index": 0}],
      "title": "常量", "properties": {"value": 1}
    },
    {
      "id": 3, "type": "basic/math",
      "pos": [576, 223], "size": [169.6, 66],
      "flags": {}, "order": 3, "mode": 0,
      "inputs": [
        {"name": "A", "type": "number", "link": 1},
        {"name": "B", "type": "number", "link": 2}
      ],
      "outputs": [{"name": "result", "type": "number", "links": [3], "slot_index": 0}],
      "title": "数学运算", "properties": {"operation": "add"}
    },
    {
      "id": 5, "type": "basic/my-watch",
      "pos": [797, 237], "size": [169.6, 46],
      "flags": {}, "order": 4, "mode": 0,
      "inputs": [{"name": "value", "type": "", "link": 3}],
      "title": "值监视器", "properties": {}
    }
  ],
  "links": [
    [1, 2, 0, 3, 0, "number"],
    [2, 4, 0, 3, 1, "number"],
    [3, 3, 0, 5, 0, "number"]
  ],
  "groups": [], "config": {}, "extra": {}, "version": 0.4
}
```

**link 格式说明**：`[link_id, origin_node_id, origin_slot, target_node_id, target_slot, type]`
- link 1：常量(id=2).value → 数学(id=3).A
- link 2：常量(id=4).value → 数学(id=3).B
- link 3：数学(id=3).result → 监视器(id=5).value

**写入文件格式**：保持原文件「整个 JSON 作为字符串赋给全局变量」的形式。完整目标文件内容（单行字符串化）：

```javascript
var Index_1_JsonData = "{\"last_node_id\":6,\"last_link_id\":3,\"nodes\":[{\"id\":6,\"type\":\"basic/start\",\"pos\":[100,250],\"size\":{\"0\":140,\"1\":40},\"flags\":{},\"order\":0,\"mode\":0,\"outputs\":[{\"name\":\"start\",\"type\":\"__EVENT__\",\"links\":null}],\"title\":\"开始节点\",\"properties\":{}},{\"id\":2,\"type\":\"basic/const\",\"pos\":[325,204],\"size\":{\"0\":169.60000610351562,\"1\":46},\"flags\":{},\"order\":1,\"mode\":0,\"outputs\":[{\"name\":\"value\",\"type\":\"number\",\"links\":[1],\"slot_index\":0}],\"title\":\"常量\",\"properties\":{\"value\":1}},{\"id\":4,\"type\":\"basic/const\",\"pos\":[317,303],\"size\":{\"0\":169.60000610351562,\"1\":46},\"flags\":{},\"order\":2,\"mode\":0,\"outputs\":[{\"name\":\"value\",\"type\":\"number\",\"links\":[2],\"slot_index\":0}],\"title\":\"常量\",\"properties\":{\"value\":1}},{\"id\":3,\"type\":\"basic/math\",\"pos\":[576,223],\"size\":{\"0\":169.60000610351562,\"1\":66},\"flags\":{},\"order\":3,\"mode\":0,\"inputs\":[{\"name\":\"A\",\"type\":\"number\",\"link\":1},{\"name\":\"B\",\"type\":\"number\",\"link\":2}],\"outputs\":[{\"name\":\"result\",\"type\":\"number\",\"links\":[3],\"slot_index\":0}],\"title\":\"数学运算\",\"properties\":{\"operation\":\"add\"}},{\"id\":5,\"type\":\"basic/my-watch\",\"pos\":[797,237],\"size\":{\"0\":169.60000610351562,\"1\":46},\"flags\":{},\"order\":4,\"mode\":0,\"inputs\":[{\"name\":\"value\",\"type\":\"\",\"link\":3}],\"title\":\"值监视器\",\"properties\":{}}],\"links\":[[1,2,0,3,0,\"number\"],[2,4,0,3,1,\"number\"],[3,3,0,5,0,\"number\"]],\"groups\":[],\"config\":{},\"extra\":{},\"version\":0.4}";
```

- [ ] **Step 2: 手动浏览器验证（数据加载）**

操作：
1. 浏览器打开 `web-litegraph/index_1.html`
2. 观察 Console

预期：
- 画布上呈现 5 个节点：1 个「开始节点」（独立，未连数据线）、2 个「常量」、1 个「数学运算」、1 个「值监视器」
- 节点连线为：常量→数学→监视器的加法链路（3 条数据线）；开始节点独立无数据连线
- **Console 无 slot 相关警告**（如 `Could not find slot` / `onTrigger` 相关警告）
- 节点视觉上不再显示多余的 `onTrigger` 输入口、`onExecuted` 输出口

> 注：此时尚未点击「启动图形」，监视器显示 `value: `（空），属正常。

- [ ] **Step 3: Commit**

```bash
git add web-litegraph/json/index_1.js
git commit -m "fix(json): 重新生成默认图，mode=0 且去除多余 slots 与事件链路"
```

---

## Task 3: ConstNode 改造（同步执行 + 自管理高亮）

**Files:**
- Modify: `web-litegraph/index_1.html` — `ConstNode` 类（当前 100-110 行）

**对应 Design Doc:** §2 节点定义表
**对应 Spec:** Requirement「自动拓扑执行能完成计算」「运行时新增节点可执行且可高亮」

- [ ] **Step 1: 修改 ConstNode.onExecute**

将当前：
```javascript
        onExecute() {
            this.setOutputData(0, this.properties.value);
        }
```

替换为：
```javascript
        onExecute() {
            this.setOutputData(0, this.properties.value);
            // 常量节点同步输出完成，立即标记为已执行
            setNodeHighlight(this, 'executed');
        }
```

- [ ] **Step 2: 手动浏览器验证（常量高亮）**

操作：
1. 刷新 `web-litegraph/index_1.html`
2. 点击「启动图形」按钮

预期：2 个常量节点在启动后很快变为**绿色**（executed 高亮）。监视器此时尚未显示 2（MathNode 延迟未完成），属正常。

- [ ] **Step 3: Commit**

```bash
git add web-litegraph/index_1.html
git commit -m "feat(const-node): 同步输出并自管理 executed 高亮"
```

---

## Task 4: MathNode 改造（延迟状态机）

**Files:**
- Modify: `web-litegraph/index_1.html` — `MathNode` 类（当前 112-135 行）

**对应 Design Doc:** §数据流与状态机 / MathNode 延迟状态机
**对应 Spec:** Requirement「执行延迟高亮不破坏拓扑顺序」「自动拓扑执行能完成计算」

> ⚠️ 本任务是修复的核心。当前 `async onExecute` 是 bug 根因，必须改为同步状态机。

- [ ] **Step 1: 替换整个 MathNode 类**

将当前 MathNode 类（含 `async onExecute` + `await setTimeout`）：

```javascript
    class MathNode extends LGraphNode {
        constructor() {
            super();
            this.title = "数学运算";
            this.addInput("A", "number");
            this.addInput("B", "number");
            this.addOutput("result", "number");
            this.properties = { operation: "add" };
        }
        async onExecute() {
            const A = this.getInputData(0);
            const B = this.getInputData(1);
            if (A == null || B == null) return;
            let result = 0;
            await new Promise(resolve => setTimeout(resolve, 1500));
            switch(this.properties.operation) {
                case "add": result = A + B; break;
                case "sub": result = A - B; break;
                case "mul": result = A * B; break;
                case "div": result = A / B; break;
            }
            this.setOutputData(0, result);
        }
    }
```

替换为（同步 onExecute + 延迟状态机）：

```javascript
    class MathNode extends LGraphNode {
        constructor() {
            super();
            this.title = "数学运算";
            this.addInput("A", "number");
            this.addInput("B", "number");
            this.addOutput("result", "number");
            this.properties = { operation: "add" };
            // 延迟状态机字段：与 LiteGraph 同步执行模型协同，通过多帧推进实现延迟计算
            this._lastInputs = null;
            this._pendingTimer = null;
            this._computing = false;
            this._cachedResult = null;
        }
        onExecute() {
            const A = this.getInputData(0);
            const B = this.getInputData(1);

            // 输入未就绪：输出空，不启动计时（避免无效延迟）
            if (A == null || B == null) {
                this.setOutputData(0, null);
                return;
            }

            // 输入变化检测：用值比较实现「输入变化」语义
            // 不能用 [A,B] !== _lastInputs（引用永远不等，会每帧重复触发）
            const inputChanged = !this._lastInputs
                || this._lastInputs[0] !== A
                || this._lastInputs[1] !== B;

            if (inputChanged) {
                this._lastInputs = [A, B];
                this._computing = true;
                setNodeHighlight(this, 'executing');
                this.setOutputData(0, null);
                clearTimeout(this._pendingTimer);
                // 延迟回调内 setOutputData + setDirtyCanvas，靠下一帧 runStep 推给下游
                this._pendingTimer = setTimeout(() => {
                    this._cachedResult = this._compute(A, B);
                    this._computing = false;
                    this.setOutputData(0, this._cachedResult);
                    setNodeHighlight(this, 'executed');
                    this.setDirtyCanvas(true, true);
                }, 1500);
            } else if (this._computing) {
                // 计算中：保持空输出，等待延迟回调
                this.setOutputData(0, null);
            } else {
                // 已完成：持续输出缓存结果（幂等，不重复触发计时）
                this.setOutputData(0, this._cachedResult);
            }
        }
        // 按 operation 执行实际运算，抽离以保持 onExecute 状态机分支清晰
        _compute(A, B) {
            let result = 0;
            switch (this.properties.operation) {
                case "add": result = A + B; break;
                case "sub": result = A - B; break;
                case "mul": result = A * B; break;
                case "div": result = A / B; break;
            }
            return result;
        }
    }
```

**关键点说明：**
- `onExecute` 必须是同步函数（移除 `async`），否则 `runStep` 不 await，下游读 undefined
- 输入变化检测用 `_lastInputs[0] !== A || _lastInputs[1] !== B`（值比较）
- 三个分支：`inputChanged`（重算）/ `_computing`（保持 null）/ else（保持结果）
- `clearTimeout` 防止输入快速变化时旧回调污染新结果
- `_compute` 抽离保持 switch 逻辑可复用、onExecute 状态机清晰

- [ ] **Step 2: 手动浏览器验证（延迟状态机核心场景）**

操作：
1. 刷新 `web-litegraph/index_1.html`
2. 点击「启动图形」按钮
3. 立即观察数学节点与监视器（t≈0ms）
4. 等待约 1.5s 后再次观察（t≈1500ms）

预期：
- **t≈0ms**：数学节点变**黄色**（executing）；监视器显示 `value: `（空）
- **t≈1500ms**：数学节点变**绿色**（executed）；监视器显示 `value: 2`
- Console 无错误，无 `Cannot read properties of undefined`
- **重复观察**：再次点击「启动图形」，数学节点保持绿色，监视器保持 `value: 2`（不重复触发延迟，验证幂等分支）

- [ ] **Step 3: Commit**

```bash
git add web-litegraph/index_1.html
git commit -m "fix(math-node): 改造为同步 onExecute + 延迟状态机，解决 async 与 runStep 冲突"
```

---

## Task 5: WatchNode 改造（自管理高亮 + null 显示空）

**Files:**
- Modify: `web-litegraph/index_1.html` — `WatchNode` 类（当前 137-160 行）

**对应 Design Doc:** §2 节点定义表（WatchNode：value 为 null 显示空，否则显示值）
**对应 Spec:** Requirement「执行延迟高亮不破坏拓扑顺序」

- [ ] **Step 1: 修改 WatchNode.onExecute 增加 executed 高亮**

将当前：
```javascript
        onExecute() {
            this.value = this.getInputData(0);
            console.log("值监视器：", this.value);
            this.setDirtyCanvas(true, true);
        }
```

替换为（保留 console.log，新增高亮）：
```javascript
        onExecute() {
            this.value = this.getInputData(0);
            console.log("值监视器：", this.value);
            // 监视器拿到上游值即标记已执行（含 null 情况，体现延迟期间状态）
            setNodeHighlight(this, 'executed');
            this.setDirtyCanvas(true, true);
        }
```

- [ ] **Step 2: 修改 WatchNode.onDrawBackground 让 null 显示空**

将当前：
```javascript
        onDrawBackground(ctx) {
            ctx.fillStyle = "#FFF";
            ctx.font = "12px Arial";

            // 显示监控的值
            const displayValue = typeof this.value === 'object'
                ? JSON.stringify(this.value)
                : String(this.value);

            ctx.fillText(`value: ${displayValue}`, 10, 30);
        }
```

替换为（null 时显示空，避免 `typeof null === 'object'` 导致显示 "null"）：
```javascript
        onDrawBackground(ctx) {
            ctx.fillStyle = "#FFF";
            ctx.font = "12px Arial";

            // 显示监控的值；value 为 null（延迟期间或未连接）时显示空
            const displayValue = this.value == null
                ? ""
                : (typeof this.value === 'object'
                    ? JSON.stringify(this.value)
                    : String(this.value));

            ctx.fillText(`value: ${displayValue}`, 10, 30);
        }
```

- [ ] **Step 3: 手动浏览器验证（监视器 null/值切换）**

操作：
1. 刷新页面，点击「启动图形」
2. 观察监视器在延迟期间（前 1.5s）与延迟结束后

预期：
- 延迟期间：监视器显示 `value: `（空白，不显示 `null`），节点变绿
- 延迟结束后：监视器显示 `value: 2`，节点保持绿
- Console 持续打印 `值监视器：null`（延迟期间）→ `值监视器：2`（结束后）

- [ ] **Step 4: Commit**

```bash
git add web-litegraph/index_1.html
git commit -m "feat(watch-node): 自管理高亮且 null 时显示空"
```

---

## Task 6: StartNode 改造（自管理高亮）

**Files:**
- Modify: `web-litegraph/index_1.html` — `StartNode` 类（当前 89-98 行）

**对应 Design Doc:** §2 节点定义表（StartNode：onExecute triggerSlot(0) + 高亮 executed）
**对应 Spec:** Requirement「事件触发执行能完成计算」

- [ ] **Step 1: 修改 StartNode.onExecute 增加高亮**

将当前：
```javascript
        onExecute() {
            this.triggerSlot(0);
        }
```

替换为：
```javascript
        onExecute() {
            this.triggerSlot(0);
            // 开始节点触发事件后标记已执行
            setNodeHighlight(this, 'executed');
        }
```

- [ ] **Step 2: 手动浏览器验证（开始节点高亮）**

操作：
1. 刷新页面（默认图无开始节点）
2. 在左侧节点库点击「开始节点」添加一个开始节点到画布
3. 点击「开始执行」按钮

预期：
- 点击「开始执行」后，开始节点变**绿色**（executed）
- Console 无错误（验证 Task 9 的 runStep 修复配合）

> 注：默认图无开始节点，本任务验证需手动添加。开始节点高亮在端到端验证（Task 11）也会覆盖。

- [ ] **Step 3: Commit**

```bash
git add web-litegraph/index_1.html
git commit -m "feat(start-node): 触发事件后自管理 executed 高亮"
```

---

## Task 7: 修复 loadGraph()（startNode 单节点 + 移除插件调用）

**Files:**
- Modify: `web-litegraph/index_1.html` — `loadGraph` 函数（当前 184-195 行）

**对应 Design Doc:** §4 控制函数表（loadGraph：graph.startNode 按 type === "basic/start" 查找单节点）
**对应 Spec:** Requirement「事件触发执行能完成计算」（不存在开始节点时不报错）

- [ ] **Step 1: 替换 loadGraph 函数体**

将当前：
```javascript
    function loadGraph() {
        const jsonData = localStorage.getItem("my_graph");
        const data = jsonData ? JSON.parse(jsonData) : JSON.parse(Index_1_JsonData);
        if (data) {
            graph.configure(data);
            graph.startNode = graph._nodes.filter(node => node.title === '开始节点');
            CustomLiteGraphHighlightPlugin(graph)
            outputDiv.innerHTML = "图形已加载";
        } else {
            outputDiv.innerHTML = "没有找到保存的图形";
        }
    }
```

替换为：
```javascript
    function loadGraph() {
        const jsonData = localStorage.getItem("my_graph");
        const data = jsonData ? JSON.parse(jsonData) : JSON.parse(Index_1_JsonData);
        if (data) {
            graph.configure(data);
            // startNode 按 type 查找单节点引用（find 而非 filter），与 runStep/addNode 保持一致
            // 高亮已由各节点 onExecute 自管理，无需调用插件包装
            graph.startNode = graph._nodes.find(node => node.type === "basic/start") || null;
            outputDiv.innerHTML = "图形已加载";
        } else {
            outputDiv.innerHTML = "没有找到保存的图形";
        }
    }
```

**关键点：**
- `filter` → `find`：返回单节点而非数组
- 查找条件 `title === '开始节点'` → `type === "basic/start"`：按类型更稳健（标题可能被修改）
- `|| null`：无开始节点时显式置 null，配合 runStep 的 falsy 判断
- 移除 `CustomLiteGraphHighlightPlugin(graph)` 调用（高亮已自管理）

- [ ] **Step 2: 手动浏览器验证（加载无报错）**

操作：
1. 刷新页面（首次加载会调用 `loadGraph()`）
2. 观察 Console

预期：
- Console **无** `CustomLiteGraphHighlightPlugin is not defined` 错误（已移除调用）
- 画布正常呈现默认图 5 个节点（含开始节点）
- 在 Console 输入 `graph.startNode`，预期输出一个 `StartNode` 实例（默认图含开始节点，find 按类型查到）

- [ ] **Step 3: Commit**

```bash
git add web-litegraph/index_1.html
git commit -m "fix(load-graph): startNode 用 find 返回单节点并移除已废弃的插件调用"
```

---

## Task 8: 确认 addNode() 已符合单引用语义

**Files:**
- Read-only verify: `web-litegraph/index_1.html` — `addNode` 函数（当前 169-176 行）

**对应 Design Doc:** §4 控制函数表（addNode：若 type 为 basic/start，设置 graph.startNode 为该节点单引用）

- [ ] **Step 1: 核对 addNode 当前实现**

当前 `addNode` 代码：
```javascript
    function addNode(type) {
        const node = LiteGraph.createNode(type);
        node.pos = [200 + Math.ceil(Math.random() * 50), 200 + Math.ceil(Math.random() * 50)];
        graph.add(node);
        if (type === "basic/start") {
            graph.startNode = node;
        }
    }
```

核对结论：**已符合 Design Doc 要求**（`graph.startNode = node` 为单节点引用，非数组）。本任务**无需代码改动**，仅记录核对结果。

> 若实施时发现该函数已被其他改动影响，则按 Design Doc 恢复为上述单引用形式。

- [ ] **Step 2: 手动浏览器验证（新增开始节点的 startNode 绑定）**

操作：
1. 刷新页面
2. 在 Console 输入 `graph.startNode`，确认输出 `null`
3. 点击左侧「开始节点」添加一个开始节点
4. 再次在 Console 输入 `graph.startNode`

预期：
- 步骤 2 输出 `null`
- 步骤 4 输出一个 `StartNode` 实例对象（非数组），其 `type === "basic/start"`

- [ ] **Step 3: Commit（仅当有改动时）**

```bash
# 若核对无误、无代码改动，跳过 commit
# 若有改动：
git add web-litegraph/index_1.html
git commit -m "fix(add-node): 确保 startNode 为单节点引用"
```

---

## Task 9: 修复 runStep()（单节点引用 + 安全降级）

**Files:**
- Modify: `web-litegraph/index_1.html` — `runStep` 函数（当前 216-222 行）

**对应 Design Doc:** §4 控制函数表（runStep：if graph.startNode 则 onExecute；无开始节点仅刷新画布不报错）
**对应 Spec:** Requirement「事件触发执行能完成计算」（不存在开始节点时不报错）

> ⚠️ 当前 `graph.startNode[0].onExecute()` 是数组访问 bug，与 Task 7 的单节点引用修复配套必须改。

- [ ] **Step 1: 替换 runStep 函数体**

将当前：
```javascript
    function runStep() {
        if (graph.startNode && graph.startNode[0]) {
            graph.startNode[0].onExecute();
        }
        graph.setDirtyCanvas(true, true);
        outputDiv.innerHTML = "执行开始完成";
    }
```

替换为：
```javascript
    function runStep() {
        // startNode 为单节点引用：存在则触发其 onExecute，不存在则安全降级仅刷新画布
        if (graph.startNode) {
            graph.startNode.onExecute();
        }
        graph.setDirtyCanvas(true, true);
        outputDiv.innerHTML = "执行开始完成";
    }
```

**关键点：**
- `graph.startNode[0]` → `graph.startNode`：去除数组下标（startNode 已是单节点）
- `graph.startNode && graph.startNode[0]` → `graph.startNode`：falsy 判断即可
- 无开始节点时不进入 if，仅 `setDirtyCanvas`，不抛异常

- [ ] **Step 2: 手动浏览器验证（无开始节点不报错 + 有开始节点触发）**

操作 A（默认图含开始节点）：
1. 刷新页面
2. 点击「开始执行」按钮

预期 A：
- Console **无** `Cannot read properties of undefined (reading 'onExecute')` 等错误
- 工具栏下方显示「执行开始完成」
- 开始节点变**绿色**（executed，graph.startNode 已被 find 查到）
- 画布正常刷新

操作 B（验证无开始节点安全降级）：
3. 选中开始节点按 Delete 删除
4. 在 Console 输入 `graph.startNode`（此时仍为旧引用，需刷新）
5. 刷新页面，在 Console 输入 `graph.startNode` 确认输出 `null`
6. 点击「开始执行」按钮

预期 B：
- Console 无错误（验证无开始节点时安全降级）
- 工具栏下方显示「执行开始完成」

- [ ] **Step 3: Commit**

```bash
git add web-litegraph/index_1.html
git commit -m "fix(run-step): 去除数组下标访问，无开始节点时安全降级不报错"
```

---

## Task 10: 确认 forceRunStep() 依赖输入变化检测

**Files:**
- Read-only verify: `web-litegraph/index_1.html` — `forceRunStep` 函数（当前 224-229 行）

**对应 Design Doc:** §4 控制函数表（forceRunStep：保留 graph.runStep(0.1, false, true)；靠 MathNode 输入变化检测实现重算）

- [ ] **Step 1: 核对 forceRunStep 当前实现**

当前 `forceRunStep` 代码：
```javascript
    function forceRunStep() {
        // 强制重新执行所有节点
        graph.runStep(0.1, false, true);
        graph.setDirtyCanvas(true, true);
        outputDiv.innerHTML = "强制重新执行完成";
    }
```

核对结论：**已符合 Design Doc 要求**。`graph.runStep(0.1, false, true)` 会重算所有 mode=0 节点；MathNode 的 `_lastInputs` 输入变化检测会捕获常量新值并启动新一轮延迟。本任务**无需代码改动**，仅记录核对结果，并在端到端验证（Task 11）确认行为。

> 若实施时发现该函数已被其他改动影响，则按 Design Doc 恢复为上述形式。

- [ ] **Step 2: 手动浏览器验证（留待 Task 11 场景 6 统一验证）**

本任务的验证合并到 Task 11 的「场景 6：强制重新执行后结果更新」，避免重复操作。

- [ ] **Step 3: Commit（仅当有改动时）**

```bash
# 若核对无误、无代码改动，跳过 commit
# 若有改动：
git add web-litegraph/index_1.html
git commit -m "fix(force-run-step): 确认依赖 MathNode 输入变化检测实现重算"
```

---

## Task 11: 端到端手动验证（覆盖 Spec 全部 7 个 Requirement）

**Files:**
- Read-only verify: `web-litegraph/index_1.html`

**对应 Spec:** 全部 Requirement 与 Scenario

> 这是交付前的总验证。逐场景执行，每通过一个打勾。任何场景失败，回到对应 Task 修复后重验。

- [ ] **Step 1: 准备环境**

操作：
1. 关闭浏览器 DevTools 的 localStorage 模拟干扰
2. 在 DevTools Console 执行 `localStorage.removeItem('my_graph')` 清除本地缓存（确保加载默认图）
3. 刷新 `web-litegraph/index_1.html`

- [ ] **Step 2: 场景 1 — 默认图无悬空 slot（Requirement 1）**

预期：
- Console 无 slot 相关警告
- 4 个节点无多余 slot 显示

- [ ] **Step 3: 场景 2 — 默认图拓扑正确（Requirement 2）**

预期：画布呈现 2 个常量 + 1 个数学运算 + 1 个值监视器，连线为常量→数学→监视器。

- [ ] **Step 4: 场景 3 — 启动图形后监视器显示 value: 2（Requirement 3）**

操作：点击「启动图形」，等待约 1.5s。

预期：监视器显示 `value: 2`。

- [ ] **Step 5: 场景 4 — 启动图形后节点依次高亮（Requirement 3）**

操作：点击「停止图形」→ 再次点击「启动图形」，立即观察。

预期：
- 常量节点迅速变**绿色**（executed）
- 数学节点先变**黄色**（executing），约 1.5s 后变**绿色**（executed）
- 监视器节点随上游值变化变绿

- [ ] **Step 6: 场景 5 — 无开始节点点「开始执行」不报错（Requirement 4）**

操作：刷新页面（默认图含开始节点）→ 点击「开始执行」确认开始节点高亮 → 选中开始节点按 Delete 删除 → 刷新页面 → 再次点击「开始执行」。

预期：两次点击 Console 都无 `Cannot read properties of undefined` 等错误，工具栏显示「执行开始完成」，画布正常。删除开始节点后刷新，`graph.startNode` 为 null，安全降级。

- [ ] **Step 7: 场景 6 — 强制重新执行后结果更新（Requirement 7，覆盖 Task 10）**

操作：
1. 点击「启动图形」等待监视器显示 `value: 2`
2. 双击任一常量节点，将 `value` 属性改为 `5`
3. 点击「强制重新执行」
4. 等待约 1.5s

预期：
- 数学节点先变**黄色**（检测到输入变化，重新延迟）
- 约 1.5s 后监视器显示 `value: 10`（5 + 5）
- 验证 forceRunStep + MathNode 输入变化检测协同工作

- [ ] **Step 8: 场景 7 — 延迟期间监视器显示空、完成后显示 2（Requirement 5）**

操作：点击「停止图形」→「启动图形」，观察延迟期间（前 1.5s）。

预期：
- 延迟期间：监视器显示 `value: `（空白，非 `null`、非 `undefined`）
- 完成后：监视器显示 `value: 2`

- [ ] **Step 9: 场景 8 — 运行时新增节点可执行且可高亮（Requirement 6）**

操作：
1. 点击「停止图形」
2. 点击左侧「常量节点」新增一个常量节点
3. 拖动连线：新常量.value → 监视器.value（先断开原数学→监视器连线）
4. 点击「启动图形」

预期：新增的常量节点变**绿色**（executed），监视器显示该常量的 `value`。验证高亮逻辑覆盖运行时新增节点。

- [ ] **Step 10: 全部通过后 Commit（验证记录）**

```bash
# 端到端验证无代码改动，无需 commit
# 若验证中发现 bug 并修复，按对应 Task 单独 commit
```

---

## Self-Review（计划作者自查）

**1. Spec coverage（Design Doc 改造点 ↔ Task 映射）：**

| Design Doc 改造点 | 覆盖 Task |
|------------------|----------|
| JSON 重新生成（mode=0、去多余 slots、去事件链路） | Task 2 |
| MathNode 延迟状态机 | Task 4 |
| 节点自管理高亮（ConstNode / MathNode / WatchNode / StartNode） | Task 3 / 4 / 5 / 6 |
| highlight.js 降级为工具函数 | Task 1 |
| runStep 修复（单节点引用 + 安全降级） | Task 9 |
| loadGraph 修复（find 单节点 + 移除插件调用） | Task 7 |
| addNode 修复（单引用确认） | Task 8 |
| forceRunStep 保留（靠输入变化检测） | Task 10 |
| 7 个 Requirement 端到端验证 | Task 11 |

无遗漏。

**2. Placeholder scan：** 全部步骤均含具体代码或具体操作/预期，无 TBD/TODO。

**3. Type consistency：**
- 工具函数名：`setNodeHighlight`（Task 1 定义）= ConstNode/MathNode/WatchNode/StartNode 调用名 ✓
- 状态字符串：`'executing'` / `'executed'` 全局一致 ✓
- MathNode 私有字段：`_lastInputs` / `_pendingTimer` / `_computing` / `_cachedResult` 定义与使用一致 ✓
- `graph.startNode`：Task 7（find 单节点）/ Task 8（= node）/ Task 9（直接 .onExecute）三方一致 ✓
- link 编号：1/2/3 在 Task 2 JSON 内部自洽（origin/target slot 引用一致）✓

---

## Execution Handoff

计划已完成并保存至 `docs/superpowers/plans/2026-06-16-litegraph-node-execution.md`。

由于本项目为纯前端、无测试框架、验证依赖手动浏览器操作，**建议采用 Inline Execution（executing-plans）**：在本会话按 Task 顺序执行，每个 Task 完成后由用户手动浏览器验证，验证通过再进入下一个 Task。Subagent-Driven 在无自动化测试的项目中收益有限（无法用测试做审查门禁）。

> 注：实际执行方式需由用户在 build 阶段确认（plan-ready 暂停点）。本计划仅为实施蓝图，未触碰任何源代码。
