import dagre from 'dagre';
import { Node, Edge } from 'reactflow';

// --- Dagre Layout Constants ---
export const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

export const NODE_WIDTH = 225; // 1.5x of 150
export const NODE_HEIGHT = 40;
export const PROJECT_NODE_WIDTH = 300; // 1.5x of 200
export const PROJECT_NODE_HEIGHT = 60;

/** タイトル長とメタデータ有無からTaskNodeの高さを推定（dagre layout用） */
export const estimateTaskNodeHeight = (title: string, hasInfoRow: boolean) => {
    const len = title?.length || 0;
    const charsPerLine = 22; // テキスト行にはアイコンがないので幅が広い
    const lines = Math.max(1, Math.ceil(len / charsPerLine));
    const textHeight = Math.max(30, 14 + lines * 16);
    const infoRowHeight = hasInfoRow ? 20 : 0;
    return textHeight + infoRowHeight;
};

export function getLayoutedElements(nodes: Node[], edges: Edge[]): { nodes: Node[], edges: Edge[] } {
    // CRITICAL: Reset dagre graph to clear any stale node/edge data from previous layouts
    // This prevents "gap" issues when nodes are deleted and new ones are added
    dagreGraph.nodes().forEach(n => dagreGraph.removeNode(n));

    dagreGraph.setGraph({
        rankdir: 'LR',
        nodesep: 30,
        ranksep: 120,
        align: undefined // Ensures children center around parent (default behavior)
    });

    nodes.forEach((node) => {
        let width = NODE_WIDTH;
        let height = NODE_HEIGHT;

        if (node.type === 'projectNode') {
            width = PROJECT_NODE_WIDTH;
            height = PROJECT_NODE_HEIGHT;
        } else if (node.type === 'taskNode' && node.height) {
            height = node.height;
        }

        dagreGraph.setNode(node.id, { width, height });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    const layoutedNodes = nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        let width = NODE_WIDTH;
        let height = NODE_HEIGHT;

        if (node.type === 'projectNode') {
            width = PROJECT_NODE_WIDTH;
            height = PROJECT_NODE_HEIGHT;
        } else if (node.type === 'taskNode' && node.height) {
            height = node.height;
        }

        return {
            ...node,
            position: {
                x: nodeWithPosition.x - width / 2,
                y: nodeWithPosition.y - height / 2,
            },
        };
    });

    return { nodes: layoutedNodes, edges };
}
