"use client"

import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react"

export type SignaturePadHandle = {
  isEmpty: () => boolean
  toDataURL: () => string
  clear: () => void
}

type Props = {
  width?: number
  height?: number
  className?: string
  onChange?: (isEmpty: boolean) => void
}

const SignaturePad = forwardRef<SignaturePadHandle, Props>(
  ({ width, height = 200, className = "", onChange }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const isDrawing = useRef(false)
    const lastPoint = useRef<{ x: number; y: number } | null>(null)
    const hasStrokes = useRef(false)

    const getPos = (e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) => {
      const rect = canvas.getBoundingClientRect()
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height
      if ("touches" in e) {
        const touch = e.touches[0]
        return {
          x: (touch.clientX - rect.left) * scaleX,
          y: (touch.clientY - rect.top) * scaleY,
        }
      }
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      }
    }

    const startDraw = useCallback((e: MouseEvent | TouchEvent) => {
      const canvas = canvasRef.current
      if (!canvas) return
      e.preventDefault()
      isDrawing.current = true
      lastPoint.current = getPos(e, canvas)
    }, [])

    const draw = useCallback(
      (e: MouseEvent | TouchEvent) => {
        if (!isDrawing.current) return
        const canvas = canvasRef.current
        if (!canvas) return
        e.preventDefault()
        const ctx = canvas.getContext("2d")
        if (!ctx) return

        const pos = getPos(e, canvas)
        const last = lastPoint.current

        ctx.beginPath()
        ctx.moveTo(last?.x ?? pos.x, last?.y ?? pos.y)
        ctx.lineTo(pos.x, pos.y)
        ctx.strokeStyle = "#1e293b"
        ctx.lineWidth = 2.5
        ctx.lineCap = "round"
        ctx.lineJoin = "round"
        ctx.stroke()

        lastPoint.current = pos
        if (!hasStrokes.current) {
          hasStrokes.current = true
          onChange?.(false)
        }
      },
      [onChange]
    )

    const stopDraw = useCallback(() => {
      isDrawing.current = false
      lastPoint.current = null
    }, [])

    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return

      // Attach passive: false for touch events so preventDefault works
      canvas.addEventListener("mousedown", startDraw)
      canvas.addEventListener("mousemove", draw)
      canvas.addEventListener("mouseup", stopDraw)
      canvas.addEventListener("mouseleave", stopDraw)
      canvas.addEventListener("touchstart", startDraw, { passive: false })
      canvas.addEventListener("touchmove", draw, { passive: false })
      canvas.addEventListener("touchend", stopDraw)

      return () => {
        canvas.removeEventListener("mousedown", startDraw)
        canvas.removeEventListener("mousemove", draw)
        canvas.removeEventListener("mouseup", stopDraw)
        canvas.removeEventListener("mouseleave", stopDraw)
        canvas.removeEventListener("touchstart", startDraw)
        canvas.removeEventListener("touchmove", draw)
        canvas.removeEventListener("touchend", stopDraw)
      }
    }, [startDraw, draw, stopDraw])

    useImperativeHandle(ref, () => ({
      isEmpty: () => !hasStrokes.current,
      toDataURL: () => canvasRef.current?.toDataURL("image/png") ?? "",
      clear: () => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext("2d")
        if (!ctx) return
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        hasStrokes.current = false
        onChange?.(true)
      },
    }))

    return (
      <canvas
        ref={canvasRef}
        width={width ?? 600}
        height={height}
        className={`touch-none cursor-crosshair ${className}`}
        style={{ width: "100%", height }}
      />
    )
  }
)

SignaturePad.displayName = "SignaturePad"
export default SignaturePad
