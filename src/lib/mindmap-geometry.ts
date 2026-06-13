// Renderer-independent sizing constants and text estimation for mind map nodes.

export const NODE_WIDTH = 180;
export const NODE_WIDTH_MOBILE = 168;
export const NODE_HEIGHT = 36;
export const PROJECT_NODE_WIDTH = 220;
export const PROJECT_NODE_HEIGHT = 52;
export const PROJECT_NODE_MIN_WIDTH = 84;
export const PROJECT_NODE_MAX_WIDTH = 320;
export const NODE_MAX_WIDTH = 220;
export const NODE_MAX_WIDTH_MOBILE = 204;
export const NODE_MIN_WIDTH = 96;
export const NODE_MIN_WIDTH_MOBILE = 144;
export const NODE_RESIZE_MAX_WIDTH = 500;

const NODE_TEXT_LINE_HEIGHT = 18;
const NODE_VERTICAL_PADDING = 12;
const LONG_NODE_HEADING_ACTION_CLEARANCE = 10;
const NODE_HORIZONTAL_PADDING = 12;
const NODE_CHECKBOX_WIDTH = 20;
const NODE_TEXT_GAP_WIDTH = 8;
const NODE_TEXT_BUFFER = 8;
const NODE_DETAIL_BUTTON_WIDTH = 20;
const NODE_DETAIL_BUTTON_WIDTH_MOBILE = 24;
const NODE_CHILD_CONTROL_GAP = 2;
const NODE_CHILD_BUTTON_MIN_WIDTH = 20;
const NODE_CHILD_BUTTON_ICON_AND_PADDING_WIDTH = 22;
const NODE_CHILD_COUNT_DIGIT_WIDTH = 6;

type TaskNodeMeasureOptions = {
    hasChildren?: boolean;
    childCount?: number;
};

const getDigitCount = (value: number) => Math.max(1, Math.floor(Math.abs(value)).toString().length);

const getTaskNodeReservedWidth = (isMobile: boolean, options: TaskNodeMeasureOptions = {}) => {
    const childButtonWidth = options.hasChildren
        ? Math.max(
            NODE_CHILD_BUTTON_MIN_WIDTH,
            NODE_CHILD_BUTTON_ICON_AND_PADDING_WIDTH + getDigitCount(options.childCount ?? 1) * NODE_CHILD_COUNT_DIGIT_WIDTH
        )
        : 0;
    const detailButtonWidth = isMobile ? NODE_DETAIL_BUTTON_WIDTH_MOBILE : NODE_DETAIL_BUTTON_WIDTH;
    const rightControlsWidth = detailButtonWidth + (options.hasChildren ? NODE_CHILD_CONTROL_GAP + childButtonWidth : 0);

    return (
        NODE_HORIZONTAL_PADDING +
        NODE_CHECKBOX_WIDTH +
        NODE_TEXT_GAP_WIDTH +
        rightControlsWidth +
        NODE_TEXT_BUFFER
    );
};

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

export const estimateTaskTitleLineCount = (
    title: string,
    nodeWidth: number = NODE_WIDTH,
    isMobile = false,
    options: TaskNodeMeasureOptions = {},
) => {
    const reserved = getTaskNodeReservedWidth(isMobile, options);
    const availableTextWidthPx = Math.max(48, nodeWidth - reserved);
    const text = (title || '').trim();

    return Math.max(
        1,
        text
            .split('\n')
            .reduce((acc, line) => {
                const linePx = estimateTextWidthPx(line);
                return acc + Math.max(1, Math.ceil(linePx / availableTextWidthPx));
            }, 0)
    );
};

export const estimateTaskNodeWidth = (title: string, isMobile = false, options: TaskNodeMeasureOptions = {}) => {
    const minW = isMobile ? NODE_MIN_WIDTH_MOBILE : NODE_MIN_WIDTH;
    const maxW = isMobile ? NODE_MAX_WIDTH_MOBILE : NODE_MAX_WIDTH;
    const reserved = getTaskNodeReservedWidth(isMobile, options);
    const text = (title || '').trim();
    if (!text) return minW;

    const longestLinePx = text
        .split('\n')
        .reduce((max, line) => Math.max(max, estimateTextWidthPx(line)), 0);
    const estimated = reserved + longestLinePx + 2;
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
    childCount = 0,
) => {
    const lines = estimateTaskTitleLineCount(title, nodeWidth, isMobile, { hasChildren, childCount });

    const textHeight = lines * NODE_TEXT_LINE_HEIGHT;
    const actionClearance = lines >= 3 ? LONG_NODE_HEADING_ACTION_CLEARANCE : 0;
    const estimated = textHeight + NODE_VERTICAL_PADDING + actionClearance;
    return Math.max(NODE_HEIGHT, estimated);
};
