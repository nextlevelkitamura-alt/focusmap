import dagre from 'dagre';
import { Node, Edge } from 'reactflow';

// --- Dagre Layout Constants ---
export const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

export const NODE_WIDTH = 224;
export const NODE_HEIGHT = 36;
export const PROJECT_NODE_WIDTH = 220;
export const PROJECT_NODE_HEIGHT = 52;
export const NODE_MAX_WIDTH = 200;
const NODE_TEXT_LINE_HEIGHT = 16;
const NODE_VERTICAL_PADDING = 12;
const NODE_INFO_ROW_HEIGHT = 16;
// 固定要素の実幅: padding(12) + grip(16) + gap×3(12) + statusDot(6) + menuBtn(20) ≈ 70px
// collapseBtn有りの場合は+16px。NODE_MIN_WIDTHでカバー
const NODE_TEXT_RESERVED_WIDTH = 70;
const NODE_MIN_WIDTH = 120;

/** テキストの視覚的な幅をピクセル単位で推定（全角≈13.5px, 半角≈7.5px @13px font-semibold） */
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
        // font-semibold は通常より若干太いため余裕を持たせる
        width += isWide ? 13.5 : 7.5;
    }
    return width;
};

/** タイトル長からTaskNodeの横幅を推定（テキストにフィット、最大NODE_MAX_WIDTH） */
export const estimateTaskNodeWidth = (title: string) => {
    const text = (title || '').trim();
    if (!text) return NODE_MIN_WIDTH;
    const longestLinePx = text
        .split('\n')
        .reduce((max, line) => Math.max(max, estimateTextWidthPx(line)), 0);
    // ノード幅 = 予約領域（アイコン等）+ テキスト幅 + 右側の余白バッファ
    const estimated = NODE_TEXT_RESERVED_WIDTH + longestLinePx + 16;
    return Math.min(NODE_MAX_WIDTH, Math.max(NODE_MIN_WIDTH, estimated));
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

    // nodesep は固定値。過去に最大ノード高さに連動させた結果、
    // 長文/メモ付きノードが1つあるだけで兄弟ノード間のギャップが全体的に膨張する副作用があったため、
    // 固定の小さい値に戻す。ノード重なり防止はノード自体の height プロパティで dagre が担保する。
    dagreGraph.setGraph({
        rankdir: 'LR',
        nodesep: 12,
        ranksep: 70,
        edgesep: 26,
        ranker: 'network-simplex',
        align: undefined
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
