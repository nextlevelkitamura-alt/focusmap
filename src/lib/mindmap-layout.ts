import dagre from 'dagre';
import { Node, Edge } from 'reactflow';

// --- Dagre Layout Constants ---
export const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

export const NODE_WIDTH = 160;
export const NODE_HEIGHT = 38;
export const PROJECT_NODE_WIDTH = 250;
export const PROJECT_NODE_HEIGHT = 52;
export const NODE_MAX_WIDTH = 320;
const NODE_TEXT_LINE_HEIGHT = 16;
const NODE_VERTICAL_PADDING = 12;
const NODE_INFO_ROW_HEIGHT = 16;
const NODE_TEXT_RESERVED_WIDTH = 64;

/** テキストの視覚的な幅をピクセル単位で推定（全角=13px, 半角=7px @13px font） */
const estimateTextWidthPx = (text: string): number => {
    let width = 0;
    for (const ch of text) {
        // CJK文字・全角記号は約13px、それ以外（ASCII等）は約7px
        const code = ch.codePointAt(0) ?? 0;
        const isWide =
            (code >= 0x3000 && code <= 0x9FFF) ||   // CJK統合漢字・ひらがな・カタカナ・記号
            (code >= 0xF900 && code <= 0xFAFF) ||   // CJK互換漢字
            (code >= 0xFF01 && code <= 0xFF60) ||   // 全角英数・記号
            (code >= 0xFFE0 && code <= 0xFFE6) ||   // 全角通貨等
            (code >= 0x20000 && code <= 0x2FA1F);   // CJK拡張
        width += isWide ? 13 : 7;
    }
    return width;
};

/** タイトル長からTaskNodeの横幅を推定（最大NODE_MAX_WIDTH） */
export const estimateTaskNodeWidth = (title: string) => {
    const text = (title || '').trim();
    const longestLinePx = text
        .split('\n')
        .reduce((max, line) => Math.max(max, estimateTextWidthPx(line)), 0);
    // テキスト利用可能幅 = ノード幅 - 左右パディング・アイコン等の予約領域
    const baseAvailablePx = NODE_WIDTH - NODE_TEXT_RESERVED_WIDTH;
    const extraPx = Math.max(0, longestLinePx - baseAvailablePx);
    const estimated = NODE_WIDTH + extraPx;
    return Math.min(NODE_MAX_WIDTH, Math.max(NODE_WIDTH, estimated));
};

/** タイトル長とメタデータ有無からTaskNodeの高さを推定（dagre layout用） */
export const estimateTaskNodeHeight = (title: string, hasInfoRow: boolean, nodeWidth: number = NODE_WIDTH) => {
    // テキスト表示可能幅（ハンドル・アイコン・メニュー用の予約幅を引く）
    const availableTextWidthPx = Math.max(64, nodeWidth - NODE_TEXT_RESERVED_WIDTH);
    const text = (title || '').trim();

    // 各行の折り返しをピクセルベースで計算
    const lines = Math.max(
        1,
        text
            .split('\n')
            .reduce((acc, line) => {
                const linePx = estimateTextWidthPx(line);
                return acc + Math.max(1, Math.ceil(linePx / availableTextWidthPx));
            }, 0)
    );

    const textHeight = lines * NODE_TEXT_LINE_HEIGHT;
    const infoRowHeight = hasInfoRow ? NODE_INFO_ROW_HEIGHT : 0;
    // Add a small safety buffer so line-wrap edits do not overlap adjacent siblings before next layout.
    const estimated = textHeight + infoRowHeight + NODE_VERTICAL_PADDING + 8;
    return Math.max(NODE_HEIGHT, estimated);
};

export function getLayoutedElements(nodes: Node[], edges: Edge[]): { nodes: Node[], edges: Edge[] } {
    // CRITICAL: Reset dagre graph to clear any stale node/edge data from previous layouts
    // This prevents "gap" issues when nodes are deleted and new ones are added
    dagreGraph.nodes().forEach(n => dagreGraph.removeNode(n));

    // ノードの最大高さに基づいて nodesep を動的に計算（重なり防止）
    let maxNodeHeight = NODE_HEIGHT;
    nodes.forEach(node => {
        const h = node.type === 'projectNode' ? PROJECT_NODE_HEIGHT : (node.height ?? NODE_HEIGHT);
        if (h > maxNodeHeight) maxNodeHeight = h;
    });
    // nodesep = 最大ノード高さの半分 + 20px余白（最低24px）
    const dynamicNodesep = Math.max(24, Math.round(maxNodeHeight / 2) + 20);

    dagreGraph.setGraph({
        rankdir: 'LR',
        nodesep: dynamicNodesep,
        ranksep: 80,
        edgesep: 26,
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
