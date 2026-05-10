import dagre from 'dagre';
import { Node, Edge } from 'reactflow';

// --- Dagre Layout Constants ---
export const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

export const NODE_WIDTH = 180;
export const NODE_WIDTH_MOBILE = 150;
export const NODE_HEIGHT = 36;
export const PROJECT_NODE_WIDTH = 220;
export const PROJECT_NODE_HEIGHT = 52;
export const NODE_MAX_WIDTH = 180;
export const NODE_MAX_WIDTH_MOBILE = 150;
export const NODE_MIN_WIDTH = 110;
export const NODE_MIN_WIDTH_MOBILE = 96;
export const NODE_RESIZE_MAX_WIDTH = 500;
const NODE_TEXT_LINE_HEIGHT = 16;
const NODE_VERTICAL_PADDING = 12;
const NODE_INFO_ROW_HEIGHT = 16;
// 固定要素の実幅: padding(8) + grip(14) + gap×3(8) + statusDot(6) + menuBtn(20) ≈ 60px
const NODE_TEXT_RESERVED_WIDTH = 60;
const NODE_TEXT_RESERVED_WIDTH_MOBILE = 56;

/** テキストの視覚的な幅をピクセル単位で推定（全角≈14.0px, 半角≈8.0px @13px font-bold） */
const estimateTextWidthPx = (text: string): number => {
    let width = 0;
    for (const ch of text) {
        const code = ch.codePointAt(0) ?? 0;
        const isWide =
            (code >= 0x3000 && code <= 0x9FFF) ||   // CJK統合漢字・ひらがな・カタカナ・記号
            (code >= 0xF900 && code <= 0xFAFF) ||   // CJK互換漢字
            (code >= 0xFF01 && code <= 0xFF60) ||   // 全角英数・記号
            (code >= 0xFFE0 && code <= 0xFFE6) ||   // 全角通貨等
            (code >= 0x20000 && code <= 0x2FA1F);   // CJK拡張
        // font-bold は font-semibold より +4〜6% 太い
        width += isWide ? 14.0 : 8.0;
    }
    return width;
};

/** タイトル長からTaskNodeの横幅を推定（テキストにフィット、最大NODE_MAX_WIDTH） */
export const estimateTaskNodeWidth = (title: string, isMobile = false) => {
    const minW = isMobile ? NODE_MIN_WIDTH_MOBILE : NODE_MIN_WIDTH;
    const maxW = isMobile ? NODE_MAX_WIDTH_MOBILE : NODE_MAX_WIDTH;
    const reserved = isMobile ? NODE_TEXT_RESERVED_WIDTH_MOBILE : NODE_TEXT_RESERVED_WIDTH;
    const text = (title || '').trim();
    if (!text) return minW;
    const longestLinePx = text
        .split('\n')
        .reduce((max, line) => Math.max(max, estimateTextWidthPx(line)), 0);
    // ノード幅 = 予約領域（アイコン等）+ テキスト幅 + 右側の余白バッファ
    const estimated = reserved + longestLinePx + 16;
    return Math.min(maxW, Math.max(minW, estimated));
};

/** タイトル長とメタデータ有無からTaskNodeの高さを推定（dagre layout用） */
export const estimateTaskNodeHeight = (
    title: string,
    hasInfoRow: boolean,
    nodeWidth: number = NODE_WIDTH,
    isMobile = false,
) => {
    const reserved = isMobile ? NODE_TEXT_RESERVED_WIDTH_MOBILE : NODE_TEXT_RESERVED_WIDTH;
    // テキスト表示可能幅（ハンドル・アイコン・メニュー用の予約幅を引く）
    const availableTextWidthPx = Math.max(64, nodeWidth - reserved);
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

    // nodesep/edgesep は固定の小さい値。BranchEdge は親の右側 sourceX+offset を
    // 共有トランクとして使うため、edgesep を大きく取る必要はない。
    // edgesep を 26 にしていた時は 5 兄弟で +104px の余白が発生し間延びしていた。
    dagreGraph.setGraph({
        rankdir: 'LR',
        nodesep: isMobile ? 2 : 4,
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
