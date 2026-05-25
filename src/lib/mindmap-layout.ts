import dagre from 'dagre';
import { Node, Edge } from 'reactflow';
import {
    NODE_WIDTH,
    NODE_WIDTH_MOBILE,
    NODE_HEIGHT,
    PROJECT_NODE_WIDTH,
    PROJECT_NODE_HEIGHT,
    NODE_MAX_WIDTH,
    NODE_MAX_WIDTH_MOBILE,
    NODE_MIN_WIDTH,
    NODE_MIN_WIDTH_MOBILE,
    NODE_RESIZE_MAX_WIDTH,
    estimateTaskNodeWidth,
    estimateTaskNodeHeight,
} from './mindmap-geometry';

export {
    NODE_WIDTH,
    NODE_WIDTH_MOBILE,
    NODE_HEIGHT,
    PROJECT_NODE_WIDTH,
    PROJECT_NODE_HEIGHT,
    NODE_MAX_WIDTH,
    NODE_MAX_WIDTH_MOBILE,
    NODE_MIN_WIDTH,
    NODE_MIN_WIDTH_MOBILE,
    NODE_RESIZE_MAX_WIDTH,
    estimateTaskNodeWidth,
    estimateTaskNodeHeight,
};

export const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

export interface LayoutOptions {
    isMobile?: boolean;
}

export function getLayoutedElements(
    nodes: Node[],
    edges: Edge[],
    opts: LayoutOptions = {},
): { nodes: Node[], edges: Edge[] } {
    const { isMobile = false } = opts;
    // CRITICAL: Reset dagre graph to clear any stale node/edge data from previous layouts
    // This prevents "gap" issues when nodes are deleted and new ones are added
    dagreGraph.nodes().forEach(n => dagreGraph.removeNode(n));

    // nodesep/edgesep は控えめに保つ。BranchEdge は親の右側 sourceX+offset を
    // 共有トランクとして使うため、edgesep を大きく取る必要はない。
    // edgesep を 26 にしていた時は 5 兄弟で +104px の余白が発生し間延びしていた。
    // nodesep は長文ノードの実描画高さとの差を吸収するため少し余白を持たせる。
    dagreGraph.setGraph({
        rankdir: 'LR',
        nodesep: isMobile ? 8 : 12,
        ranksep: isMobile ? 24 : 36,
        edgesep: 4,
        ranker: 'network-simplex',
        align: undefined
    });

    const defaultWidth = isMobile ? NODE_WIDTH_MOBILE : NODE_WIDTH;

    nodes.forEach((node) => {
        let width = defaultWidth;
        let height = NODE_HEIGHT;

        if (node.type === 'projectNode') {
            width = PROJECT_NODE_WIDTH;
            height = PROJECT_NODE_HEIGHT;
        } else if (node.type === 'taskNode' && node.height) {
            width = (node.width as number) || defaultWidth;
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
        let width = defaultWidth;
        let height = NODE_HEIGHT;

        if (node.type === 'projectNode') {
            width = PROJECT_NODE_WIDTH;
            height = PROJECT_NODE_HEIGHT;
        } else if (node.type === 'taskNode' && node.height) {
            width = (node.width as number) || defaultWidth;
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
