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
const NODE_TEXT_LINE_HEIGHT = 16;
const NODE_VERTICAL_PADDING = 8;
const NODE_INFO_ROW_HEIGHT = 16;
const NODE_TEXT_RESERVED_WIDTH = 72;

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
    // Reserve fixed space for handles/icons/menu so wrapped lines match actual rendered textarea area.
    const availableTextWidth = Math.max(64, nodeWidth - NODE_TEXT_RESERVED_WIDTH);
    const charsPerLine = Math.max(7, Math.floor(availableTextWidth / 13));
    const text = (title || '').trim();

    const lines = Math.max(
        1,
        text
            .split('\n')
            .reduce((acc, line) => acc + Math.max(1, Math.ceil((line.length || 1) / charsPerLine)), 0)
    );

    const textHeight = lines * NODE_TEXT_LINE_HEIGHT;
    const infoRowHeight = hasInfoRow ? NODE_INFO_ROW_HEIGHT : 0;
    // Add a small safety buffer so line-wrap edits do not overlap adjacent siblings before next layout.
    const estimated = textHeight + infoRowHeight + NODE_VERTICAL_PADDING + 6;
    return Math.max(NODE_HEIGHT, estimated);
};

export function getLayoutedElements(nodes: Node[], edges: Edge[]): { nodes: Node[], edges: Edge[] } {
    // CRITICAL: Reset dagre graph to clear any stale node/edge data from previous layouts
    // This prevents "gap" issues when nodes are deleted and new ones are added
    dagreGraph.nodes().forEach(n => dagreGraph.removeNode(n));

    dagreGraph.setGraph({
        rankdir: 'LR',
        nodesep: 30,
        ranksep: 96,
        edgesep: 18,
        ranker: 'network-simplex',
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
                // Snap to integer pixels to avoid subpixel anti-alias jitter on edges.
                x: Math.round(nodeWithPosition.x - width / 2),
                y: Math.round(nodeWithPosition.y - height / 2),
            },
        };
    });

    return { nodes: layoutedNodes, edges };
}
