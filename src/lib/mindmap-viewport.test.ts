import { describe, expect, test } from "vitest"
import {
  getMindMapViewportBounds,
  getPinchViewportTransform,
  getViewportTransformAtPoint,
} from "./mindmap-viewport"

describe("mindmap viewport helpers", () => {
  test("allows a wider mind map zoom range", () => {
    expect(getMindMapViewportBounds()).toEqual({ minZoom: 0.2, maxZoom: 2.5 })
  })

  test("keeps the stage point under the zoom origin stable", () => {
    const bounds = getMindMapViewportBounds()
    const origin = { x: 320, y: 180 }
    const currentPan = { x: 20, y: -40 }
    const currentZoom = 0.75
    const beforeStagePoint = {
      x: (origin.x - currentPan.x) / currentZoom,
      y: (origin.y - currentPan.y) / currentZoom,
    }

    const next = getViewportTransformAtPoint({
      currentZoom,
      currentPan,
      nextZoom: 1.2,
      origin,
      bounds,
    })

    expect((origin.x - next.pan.x) / next.zoom).toBeCloseTo(beforeStagePoint.x)
    expect((origin.y - next.pan.y) / next.zoom).toBeCloseTo(beforeStagePoint.y)
  })

  test("combines pinch zoom with midpoint panning", () => {
    const bounds = getMindMapViewportBounds()
    const next = getPinchViewportTransform({
      start: {
        initialDistance: 100,
        initialZoom: 0.8,
        initialStagePoint: { x: 200, y: 120 },
      },
      currentDistance: 150,
      currentMidpoint: { x: 360, y: 260 },
      bounds,
    })

    expect(next.zoom).toBeCloseTo(1.2)
    expect(next.pan.x).toBeCloseTo(120)
    expect(next.pan.y).toBeCloseTo(116)
  })

  test("clamps zoom to the wider mind map bounds", () => {
    const bounds = getMindMapViewportBounds()
    const next = getPinchViewportTransform({
      start: {
        initialDistance: 100,
        initialZoom: 1,
        initialStagePoint: { x: 0, y: 0 },
      },
      currentDistance: 300,
      currentMidpoint: { x: 0, y: 0 },
      bounds,
    })

    expect(next.zoom).toBe(2.5)
  })

  test("can dampen pinch sensitivity for touch screens", () => {
    const bounds = getMindMapViewportBounds()
    const next = getPinchViewportTransform({
      start: {
        initialDistance: 100,
        initialZoom: 0.8,
        initialStagePoint: { x: 100, y: 80 },
      },
      currentDistance: 150,
      currentMidpoint: { x: 200, y: 160 },
      bounds,
      sensitivity: 0.65,
    })

    expect(next.zoom).toBeCloseTo(0.8 * Math.pow(1.5, 0.65))
    expect(next.zoom).toBeLessThan(1.2)
  })
})
