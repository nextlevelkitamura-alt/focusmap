import dagre from 'dagre';
import { Node, Edge } from 'reactflow';

// --- Dagre Layout Constants ---
export const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

export const NODE_WIDTH = 160;
export const NODE_HEIGHT = 38;
export const PROJECT_NODE_WIDTH = 250;
export const PROJECT_NODE_HEIGHT = 52;
export const NODE_MAX_WIDTH = Math.round(NODE_WIDTH * 1.5);

/** タイトル長からTaskNodeの横幅を推定（最大1.5倍） */
export const estimateTaskNodeWidth = (title: string) => {
    const baseCharsPerLine = 16;
    const maxExtraChars = 14;
    const text = (title || '').trim();
    const longestLine = text
        .split('\n')
        .reduce((max, line) => Math.max(max, line.length), 0);
    const extraChars = Math.min(maxExtraChars, Math.max(0, longestLine - baseCharsPerLine));
    const estimated = NODE_WIDTH + extraChars * 6;
    return Math.min(NODE_MAX_WIDTH, Math.max(NODE_WIDTH, estimated));
};

/** タイトル長とメタデータ有無からTaskNodeの高さを推定（dagre layout用） */
export const estimateTaskNodeHeight = (title: string, hasInfoRow: boolean, nodeWidth: number = NODE_WIDTH) => {
    const charsPerLine = Math.max(12, Math.floor(16 * (nodeWidth / NODE_WIDTH)));
    const maxLines = 6;
    const text = (title || '').trim();

    const visualLines = Math.max(
        1,
        text
            .split('\n')
            .reduce((acc, line) => acc + Math.max(1, Math.ceil((line.length || 1) / charsPerLine)), 0)
    );
    const lines = Math.min(maxLines, visualLines);

    const textHeight = 12 + lines * 16;
    const infoRowHeight = hasInfoRow ? 16 : 0;
    return Math.max(NODE_HEIGHT, textHeight + infoRowHeight);
};

export function getLayoutedElements(nodes: Node[], edges: Edge[]): { nodes: Node[], edges: Edge[] } {
    // CRITICAL: Reset dagre graph to clear any stale node/edge data from previous layouts
    // This prevents "gap" issues when nodes are deleted and new ones are added
    dagreGraph.nodes().forEach(n => dagreGraph.removeNode(n));

    dagreGraph.setGraph({
        rankdir: 'LR',
        nodesep: 20,
        ranksep: 88,
        align: undefined // Ensures children center around parent (default behavior)
    });

    nodes.forEach((node) => {
        let width = NODE_WIDTH;
        let height = NODE_HEIGHT;

        if (node.type === 'projectNode') {
            width = PROJECT_NODE_WIDTH;
            height = PROJECT_NODE_HEIGHT;
        } else if (node.type === 'taskNode' && node.height) {
            width = (node.width as number) || NODE_WIDTH;
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
            width = (node.width as number) || NODE_WIDTH;
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
