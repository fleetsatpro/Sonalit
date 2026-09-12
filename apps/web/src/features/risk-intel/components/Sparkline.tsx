import { useEffect, useRef } from 'react'

interface Props {
  data: number[]
  color: string
  width?: number
  height?: number
}

export default function Sparkline({ data, color, width = 55, height = 20 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = width + 'px'
    canvas.style.height = height + 'px'
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)

    if (!data.length) return
    const max = Math.max(...data, 1)
    const pts = data.map((v, i) => ({
      x: i * (width / (data.length - 1)),
      y: height - (v / max) * (height - 3) - 1,
    }))

    // Parse color to rgb
    const hex = color.replace('#', '')
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)

    // Bezier curve
    ctx.beginPath()
    ctx.moveTo(pts[0]!.x, pts[0]!.y)
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1]!
      const curr = pts[i]!
      const mx = (prev.x + curr.x) / 2
      ctx.bezierCurveTo(mx, prev.y, mx, curr.y, curr.x, curr.y)
    }

    // Fill gradient
    const grad = ctx.createLinearGradient(0, 0, 0, height)
    grad.addColorStop(0, `rgba(${r},${g},${b},.18)`)
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.lineTo(pts[pts.length - 1]!.x, height)
    ctx.lineTo(pts[0]!.x, height)
    ctx.closePath()
    ctx.fillStyle = grad
    ctx.fill()

    // Stroke line
    ctx.beginPath()
    ctx.moveTo(pts[0]!.x, pts[0]!.y)
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1]!
      const curr = pts[i]!
      const mx = (prev.x + curr.x) / 2
      ctx.bezierCurveTo(mx, prev.y, mx, curr.y, curr.x, curr.y)
    }
    ctx.strokeStyle = color
    ctx.lineWidth = 1.4
    ctx.stroke()

    // Dots
    for (const pt of pts) {
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, 1.8, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
    }
  }, [data, color, width, height])

  return <canvas ref={canvasRef} width={width} height={height} />
}
