export type ViewportPoint = {
  x: number
  y: number
}

export type MindMapViewportBounds = {
  minZoom: number
  maxZoom: number
}

export type PinchViewportStart = {
  initialDistance: number
  initialZoom: number
  initialStagePoint: ViewportPoint
}

const DEFAULT_PINCH_SENSITIVITY = 1

export const MINDMAP_MIN_ZOOM = 0.2
export const MINDMAP_MAX_ZOOM = 2.5

export const getMindMapViewportBounds = (): MindMapViewportBounds => ({
  minZoom: MINDMAP_MIN_ZOOM,
  maxZoom: MINDMAP_MAX_ZOOM,
})

export const clampMindMapZoom = (zoom: number, bounds: MindMapViewportBounds) => {
  if (!Number.isFinite(zoom)) return bounds.minZoom
  return Math.min(bounds.maxZoom, Math.max(bounds.minZoom, zoom))
}

export const getViewportTransformAtPoint = ({
  currentZoom,
  currentPan,
  nextZoom,
  origin,
  bounds,
}: {
  currentZoom: number
  currentPan: ViewportPoint
  nextZoom: number
  origin: ViewportPoint
  bounds: MindMapViewportBounds
}) => {
  const safeCurrentZoom = currentZoom > 0 ? currentZoom : bounds.minZoom
  const clampedZoom = clampMindMapZoom(nextZoom, bounds)
  const stageX = (origin.x - currentPan.x) / safeCurrentZoom
  const stageY = (origin.y - currentPan.y) / safeCurrentZoom

  return {
    zoom: clampedZoom,
    pan: {
      x: origin.x - stageX * clampedZoom,
      y: origin.y - stageY * clampedZoom,
    },
  }
}

export const getPinchViewportTransform = ({
  start,
  currentDistance,
  currentMidpoint,
  bounds,
  sensitivity = DEFAULT_PINCH_SENSITIVITY,
}: {
  start: PinchViewportStart
  currentDistance: number
  currentMidpoint: ViewportPoint
  bounds: MindMapViewportBounds
  sensitivity?: number
}) => {
  const rawRatio = start.initialDistance > 0 ? currentDistance / start.initialDistance : 1
  const ratio = rawRatio > 0 ? Math.pow(rawRatio, sensitivity) : 1
  const zoom = clampMindMapZoom(start.initialZoom * ratio, bounds)

  return {
    zoom,
    pan: {
      x: currentMidpoint.x - start.initialStagePoint.x * zoom,
      y: currentMidpoint.y - start.initialStagePoint.y * zoom,
    },
  }
}
