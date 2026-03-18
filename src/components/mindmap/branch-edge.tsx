"use client";

import React from "react";
import { BaseEdge, EdgeProps } from "reactflow";

const BRANCH_OFFSET = 24;
const MIN_TARGET_GAP = 24;

export function BranchEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
}: EdgeProps) {
  // Use a fixed branch axis from the source so sibling edges share one trunk.
  const preferredBranchX = sourceX + BRANCH_OFFSET;
  const maxBranchX = targetX - MIN_TARGET_GAP;
  const branchX =
    preferredBranchX < maxBranchX ? preferredBranchX : (sourceX + targetX) / 2;

  // Round to integer pixels to eliminate subpixel anti-alias jaggedness.
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

  return <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />;
}

