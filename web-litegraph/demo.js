
// 初始化图形编辑器
const graph = new LGraph();

// 创建画布
const canvas = new LGraphCanvas("#container", graph);

// 创建节点
const node_const = LiteGraph.createNode("basic/const");
node_const.pos = [200,200];
node_const.setValue(4.5);
graph.add(node_const);

// 创建节点
const node_watch = LiteGraph.createNode("basic/watch");
node_watch.pos = [700,200];
graph.add(node_watch);

// 连接节点
node_const.connect(0, node_watch, 0 );

// 启动图形
graph.start()
