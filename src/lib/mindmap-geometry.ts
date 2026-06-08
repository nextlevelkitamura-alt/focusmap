// Renderer-independent sizing constants and text estimation for mind map nodes.

export const NODE_WIDTH = 180;
export const NODE_WIDTH_MOBILE = 168;
export const NODE_HEIGHT = 36;
export const PROJECT_NODE_WIDTH = 220;
export const PROJECT_NODE_HEIGHT = 52;
export const PROJECT_NODE_MIN_WIDTH = 84;
export const PROJECT_NODE_MAX_WIDTH = 220;
export const NODE_MAX_WIDTH = 220;
export const NODE_MAX_WIDTH_MOBILE = 204;
export const NODE_MIN_WIDTH = 110;
export const NODE_MIN_WIDTH_MOBILE = 144;
export const NODE_RESIZE_MAX_WIDTH = 500;

const NODE_TEXT_LINE_HEIGHT = 18;
const NODE_VERTICAL_PADDING = 12;
const NODE_TEXT_RESERVED_WIDTH = 70;
const NODE_TEXT_RESERVED_WIDTH_MOBILE = 78;
const NODE_CHILD_COUNT_RESERVED_WIDTH = 104;
const NODE_CHILD_COUNT_RESERVED_WIDTH_MOBILE = 106;
const estimateTextWidthPx = (text: string): number => {
    let width = 0;
    for (const ch of text) {
        if (/\s/.test(ch)) {
            width += 4.5;
            continue;
        }

        const code = ch.codePointAt(0) ?? 0;
        const isWide =
            (code >= 0x3000 && code <= 0x9FFF) ||
            (code >= 0xF900 && code <= 0xFAFF) ||
            (code >= 0xFF01 && code <= 0xFF60) ||
            (code >= 0xFFE0 && code <= 0xFFE6) ||
            (code >= 0x20000 && code <= 0x2FA1F);
        width += isWide ? 14.0 : 8.4;
    }
    return width;
};

export const estimateTaskNodeWidth = (title: string, isMobile = false) => {
    const minW = isMobile ? NODE_MIN_WIDTH_MOBILE : NODE_MIN_WIDTH;
    const maxW = isMobile ? NODE_MAX_WIDTH_MOBILE : NODE_MAX_WIDTH;
    const reserved = isMobile ? NODE_TEXT_RESERVED_WIDTH_MOBILE : NODE_TEXT_RESERVED_WIDTH;
    const text = (title || '').trim();
    if (!text) return minW;

    const longestLinePx = text
        .split('\n')
        .reduce((max, line) => Math.max(max, estimateTextWidthPx(line)), 0);
    const estimated = reserved + longestLinePx + 16;
    return Math.min(maxW, Math.max(minW, estimated));
};

export const estimateProjectNodeWidth = (title: string, isMobile = false) => {
    const minW = isMobile ? PROJECT_NODE_MIN_WIDTH : 96;
    const text = (title || '').trim();
    if (!text) return minW;

    const longestLinePx = text
        .split('\n')
        .reduce((max, line) => Math.max(max, estimateTextWidthPx(line)), 0);
    const estimated = longestLinePx + (isMobile ? 42 : 48);
    return Math.min(PROJECT_NODE_MAX_WIDTH, Math.max(minW, estimated));
};

export const estimateTaskNodeHeight = (
    title: string,
    _hasInfoRow: boolean,
    nodeWidth: number = NODE_WIDTH,
    isMobile = false,
    hasChildren = false,
) => {
    const reserved = hasChildren
        ? (isMobile ? NODE_CHILD_COUNT_RESERVED_WIDTH_MOBILE : NODE_CHILD_COUNT_RESERVED_WIDTH)
        : (isMobile ? NODE_TEXT_RESERVED_WIDTH_MOBILE : NODE_TEXT_RESERVED_WIDTH);
    const availableTextWidthPx = Math.max(64, nodeWidth - reserved);
    const text = (title || '').trim();

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
    const estimated = textHeight + NODE_VERTICAL_PADDING;
    return Math.max(NODE_HEIGHT, estimated);
};
