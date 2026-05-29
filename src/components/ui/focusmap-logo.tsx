import { cn } from "@/lib/utils";

type FocusmapLogoProps = {
    variant?: "horizontal" | "mark" | "stacked";
    className?: string;
    accentDot?: boolean;
    title?: string;
};

const TEAL = "#0F766E";
const ICON_DARK = "#050505";
const ICON_LIGHT = "#f8fafc";

function FocusmapIconMark({ accentDot = false }: { accentDot?: boolean }) {
    return (
        <>
            <circle cx="256" cy="256" r="248" fill={ICON_DARK} />
            <circle cx="256" cy="256" r="172" fill={ICON_LIGHT} />
            <circle cx="256" cy="256" r="138" fill={ICON_DARK} />
            <circle cx="256" cy="256" r="113" fill={ICON_LIGHT} />
            <circle cx="256" cy="256" r="79" fill={ICON_DARK} />
            <circle cx="278" cy="244" r="18" fill={accentDot ? TEAL : ICON_LIGHT} />
        </>
    );
}

export function FocusmapLogo({
    variant = "horizontal",
    className,
    accentDot = false,
    title = "Focusmap",
}: FocusmapLogoProps) {
    if (variant === "mark") {
        return (
            <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 512 512"
                className={cn("text-foreground", className)}
                role="img"
                aria-label={title}
            >
                <FocusmapIconMark accentDot={accentDot} />
            </svg>
        );
    }

    if (variant === "stacked") {
        const s = 240;
        const markSize = 80;
        const markScale = markSize / 512;
        const markX = (s - markSize) / 2;
        const markY = s * 0.18;
        const textY = markY + markSize + 36;
        return (
            <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox={`0 0 ${s} ${s}`}
                className={cn("text-foreground", className)}
                role="img"
                aria-label={title}
            >
                <g transform={`translate(${markX},${markY}) scale(${markScale.toFixed(4)})`}>
                    <FocusmapIconMark accentDot={accentDot} />
                </g>
                <text
                    x={s / 2}
                    y={textY}
                    textAnchor="middle"
                    fontFamily="var(--font-dm-sans), 'DM Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif"
                    fontWeight={600}
                    fontSize={32}
                    letterSpacing="-0.03em"
                    fill="currentColor"
                >
                    Focusmap
                </text>
            </svg>
        );
    }

    // horizontal (default)
    const w = 360;
    const h = 80;
    const pad = h * 0.12;
    const markSize = h - pad * 2;
    const markScale = markSize / 512;
    const textX = pad + markSize + 14;
    const textY = h * 0.62;
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox={`0 0 ${w} ${h}`}
            className={cn("text-foreground", className)}
            role="img"
            aria-label={title}
        >
            <g transform={`translate(${pad},${pad}) scale(${markScale.toFixed(4)})`}>
                <FocusmapIconMark accentDot={accentDot} />
            </g>
            <text
                x={textX}
                y={textY}
                fontFamily="var(--font-dm-sans), 'DM Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif"
                fontWeight={600}
                fontSize={38}
                letterSpacing="-0.03em"
                fill="currentColor"
            >
                Focusmap
            </text>
        </svg>
    );
}
