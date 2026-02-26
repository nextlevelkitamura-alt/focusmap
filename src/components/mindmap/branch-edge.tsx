"use client";

import React from "react";
import { BaseEdge, EdgeProps } from "reactflow";

const BRANCH_OFFSET = 40;
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

  const edgePath = [
    `M ${sourceX} ${sourceY}`,
    `L ${branchX} ${sourceY}`,
    `L ${branchX} ${targetY}`,
    `L ${targetX} ${targetY}`,
  ].join(" ");

  return <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />;
}

