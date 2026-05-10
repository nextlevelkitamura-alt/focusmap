"use client";

import React from "react";
import { BaseEdge, EdgeProps } from "reactflow";

export function BranchEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
  data,
}: EdgeProps) {
  const isMobile = (data as { isMobile?: boolean } | undefined)?.isMobile ?? false;
  const BRANCH_OFFSET = isMobile ? 10 : 16;
  const MIN_TARGET_GAP = isMobile ? 8 : 14;

  const preferredBranchX = sourceX + BRANCH_OFFSET;
  const maxBranchX = targetX - MIN_TARGET_GAP;
  const branchX =
    preferredBranchX < maxBranchX ? preferredBranchX : (sourceX + targetX) / 2;

  const sx = Math.round(sourceX);
  const sy = Math.round(sourceY);
  const bx = Math.round(branchX);
  const ty = Math.round(targetY);
  const tx = Math.round(targetX);

  const edgePath = [
    `M ${sx} ${sy}`,
    `L ${bx} ${sy}`,
    `L ${bx} ${ty}`,
    `L ${tx} ${ty}`,
  ].join(" ");

  const mergedStyle: React.CSSProperties = {
    stroke: "var(--muted-foreground)",
    strokeOpacity: 0.7,
    strokeWidth: 1.5,
    fill: "none",
    ...style,
  };

  return <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={mergedStyle} />;
}
