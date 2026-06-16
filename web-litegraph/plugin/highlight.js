// 执行高亮工具函数，供节点在自身状态变化时调用
function setNodeHighlight(node, state) {
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

    const style = styles[state];
    if (!style) {
        return;
    }

    node.highlightState = state;
    node.color = style.color;
    node.boxcolor = style.boxColor;
    node.setDirtyCanvas(true);
}
