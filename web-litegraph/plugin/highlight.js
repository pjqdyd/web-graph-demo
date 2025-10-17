// 快速集成的执行高亮插件
function CustomLiteGraphHighlightPlugin(graph) {
    // 包装所有节点的 onExecute 方法
    graph._nodes.forEach(node => {
        if (node.onExecute) {
            const originalExecute = node.onExecute.bind(node);
            node.onExecute = async function(...arguments) {
                highlightNode(this, 'executing');
                const result = await originalExecute(...arguments);
                highlightNode(this, 'executed');
                return result;
            };
        }
    });

    function highlightNode(node, state) {
        const styles = {
            executing: {
                color: "#796e4f",
                boxColor: "#efc083",
            },
            executed: {
                color: "#456745",
                boxColor: "#91ef8d",
            }
        };

        console.log(`Executing node ${node.title} (${state}) ${styles[state]}`);

        node.highlightState = state;
        node.color = styles[state].color;
        node.boxcolor = styles[state].boxColor;
        node.setDirtyCanvas(true);
    }
}
