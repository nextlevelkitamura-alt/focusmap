import { cn } from "@/lib/utils";

type FocusmapLogoProps = {
    variant?: "horizontal" | "mark" | "stacked";
    className?: string;
    accentDot?: boolean;
    title?: string;
};

const TEAL = "#0F766E";

export function FocusmapLogo({
    variant = "horizontal",
    className,
    accentDot = false,
    title = "Focusmap",
}: FocusmapLogoProps) {
    const dotFill = accentDot ? TEAL : "currentColor";

    if (variant === "mark") {
        return (
            <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 96 96"
                className={cn("text-foreground", className)}
                role="img"
                aria-label={title}
            >
                <g transform="translate(16,16)">
                    <g>
                        <circle cx="32" cy="32" r="25" fill="none" stroke="currentColor" strokeWidth="5.3" strokeLinecap="round" />
                        <circle cx="32" cy="32" r="16.5" fill="none" stroke="currentColor" strokeWidth="5.3" strokeLinecap="round" />
                    </g>
                    <circle cx="35.5" cy="30" r="2.8" fill={dotFill} />
                </g>
            </svg>
        );
    }

    if (variant === "stacked") {
        const s = 240;
        const markSize = 80;
        const markScale = markSize / 64;
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
                    <circle cx="32" cy="32" r="25" fill="none" stroke="currentColor" strokeWidth="5.3" strokeLinecap="round" />
                    <circle cx="32" cy="32" r="16.5" fill="none" stroke="currentColor" strokeWidth="5.3" strokeLinecap="round" />
                    <circle cx="35.5" cy="30" r="2.8" fill={dotFill} />
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
    const markScale = markSize / 64;
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
                <circle cx="32" cy="32" r="25" fill="none" stroke="currentColor" strokeWidth="5.3" strokeLinecap="round" />
                <circle cx="32" cy="32" r="16.5" fill="none" stroke="currentColor" strokeWidth="5.3" strokeLinecap="round" />
                <circle cx="35.5" cy="30" r="2.8" fill={dotFill} />
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
