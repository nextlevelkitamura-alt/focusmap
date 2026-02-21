"use client"

import { useEffect, useRef } from "react"

interface VoiceWaveformProps {
  analyserRef: React.RefObject<AnalyserNode | null>
  barCount?: number
  barWidth?: number
  barGap?: number
  height?: number
  color?: string
}

export function VoiceWaveform({
  analyserRef,
  barCount = 24,
  barWidth = 3,
  barGap = 2,
  height = 32,
  color = "rgba(239, 68, 68, {opacity})",
}: VoiceWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    const analyser = analyserRef.current
    if (!canvas || !analyser) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)
    const totalWidth = barCount * (barWidth + barGap) - barGap

    canvas.width = totalWidth
    canvas.height = height

    function draw() {
      animationRef.current = requestAnimationFrame(draw)
      analyser!.getByteFrequencyData(dataArray)

      ctx!.clearRect(0, 0, canvas!.width, canvas!.height)

      for (let i = 0; i < barCount; i++) {
        const index = Math.floor((i / barCount) * bufferLength * 0.6)
        const value = dataArray[index] / 255
        const barHeight = Math.max(3, value * (height - 4))
        const x = i * (barWidth + barGap)
        const y = (height - barHeight) / 2

        ctx!.fillStyle = color.replace("{opacity}", String(0.5 + value * 0.5))
        ctx!.beginPath()
        ctx!.roundRect(x, y, barWidth, barHeight, 1.5)
        ctx!.fill()
      }
    }

    draw()
    return () => {
      cancelAnimationFrame(animationRef.current)
    }
  }, [analyserRef, barCount, barWidth, barGap, height, color])

  return <canvas ref={canvasRef} className="h-8" style={{ width: "auto", height }} />
}
