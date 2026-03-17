import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle, useState } from 'react'

const COLORS = [
  '#ff2d2d', '#ff7700', '#ffe600', '#39ff14',
  '#00d4ff', '#a020f0', '#ff3cac', '#00e5a0',
  '#ff4500', '#7b00ff', '#00b4ff', '#ff1493',
  '#ffaa00', '#32cd32', '#e040fb', '#00cfff',
]

const FONT_SIZES = [18, 16, 14, 13, 12, 11, 10]

function getFontSize(count) {
  if (count <= 6) return FONT_SIZES[0]
  if (count <= 10) return FONT_SIZES[1]
  if (count <= 16) return FONT_SIZES[2]
  if (count <= 22) return FONT_SIZES[3]
  if (count <= 30) return FONT_SIZES[4]
  if (count <= 40) return FONT_SIZES[5]
  return FONT_SIZES[6]
}

function easeOutQuint(t) {
  return 1 - Math.pow(1 - t, 5)
}

function normalizeAngle(a) {
  const TAU = Math.PI * 2
  return ((a % TAU) + TAU) % TAU
}

export function calculateWinners(rotation, numSegments, winnerCount) {
  if (numSegments === 0) return []
  const TAU = Math.PI * 2
  const segAngle = TAU / numSegments
  const winners = []
  const seen = new Set()

  for (let j = 0; j < winnerCount; j++) {
    const pointerAngle = -Math.PI / 2 + j * (TAU / winnerCount)
    let wheelPos = normalizeAngle(pointerAngle - rotation)
    let idx = Math.floor(wheelPos / segAngle) % numSegments
    if (idx < 0) idx += numSegments
    if (!seen.has(idx)) {
      seen.add(idx)
      winners.push(idx)
    }
  }
  return winners
}

const WheelCanvas = forwardRef(function WheelCanvas(
  { participants, winnerCount, onSpinComplete, readOnly = false, externalWinners = null },
  ref
) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const rotationRef = useRef(0)
  const animRef = useRef(null)
  const spinParamsRef = useRef(null)
  const isDraggingRef = useRef(false)
  const dragDataRef = useRef(null)
  const velocityBufferRef = useRef([])

  const [isSpinning, setIsSpinning] = useState(false)
  const [winners, setWinners] = useState([])

  // Expose winner state for external use
  const winnersRef = useRef([])
  winnersRef.current = externalWinners !== null ? externalWinners : winners

  // ────────────────────────────────────────────────────────────
  // Drawing
  // ────────────────────────────────────────────────────────────
  const draw = useCallback(
    (rotation, winnerIdxs) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      const size = canvas.width
      const cx = size / 2
      const cy = size / 2
      const radius = cx - 8
      const n = participants.length

      ctx.clearRect(0, 0, size, size)

      if (n === 0) {
        ctx.fillStyle = '#334155'
        ctx.beginPath()
        ctx.arc(cx, cy, radius, 0, Math.PI * 2)
        ctx.fill()
        return
      }

      const segAngle = (Math.PI * 2) / n
      const displayWinners = winnerIdxs ?? winnersRef.current

      // ── Segments ──
      for (let i = 0; i < n; i++) {
        const start = rotation + i * segAngle
        const end = start + segAngle
        const mid = start + segAngle / 2

        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.arc(cx, cy, radius, start, end)
        ctx.closePath()

        const isWinner = displayWinners.includes(i)
        if (isWinner) {
          // golden gradient for winner
          const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
          grad.addColorStop(0, '#fff7b0')
          grad.addColorStop(1, '#f0c040')
          ctx.fillStyle = grad
        } else {
          ctx.fillStyle = COLORS[i % COLORS.length]
        }
        ctx.fill()

        // border
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'
        ctx.lineWidth = 1.5
        ctx.stroke()

        // ── Label ──
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(mid)
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        const fs = getFontSize(n)
        ctx.font = `bold ${fs}px 'Segoe UI', sans-serif`
        ctx.shadowColor = 'rgba(0,0,0,0.6)'
        ctx.shadowBlur = 4
        ctx.fillStyle = '#fff'
        const maxLen = n > 20 ? 8 : n > 12 ? 10 : 15
        const label = participants[i].length > maxLen
          ? participants[i].slice(0, maxLen) + '…'
          : participants[i]
        ctx.fillText(label, radius - 12, 0)
        ctx.restore()
      }

      // ── Outer ring ──
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 4
      ctx.stroke()

      // ── Pointers (fixed, pointing inward) ──
      const TAU = Math.PI * 2
      for (let j = 0; j < winnerCount; j++) {
        const angle = -Math.PI / 2 + j * (TAU / winnerCount)
        const tipX = cx + (radius + 2) * Math.cos(angle)
        const tipY = cy + (radius + 2) * Math.sin(angle)

        ctx.save()
        ctx.translate(tipX, tipY)
        ctx.rotate(angle + Math.PI / 2)

        // Shadow
        ctx.shadowColor = 'rgba(0,0,0,0.5)'
        ctx.shadowBlur = 6

        ctx.beginPath()
        ctx.moveTo(0, 2)       // tip (pointing inward)
        ctx.lineTo(-10, -18)
        ctx.lineTo(10, -18)
        ctx.closePath()
        ctx.fillStyle = '#f8c307'
        ctx.fill()
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.restore()
      }

      // ── Center button ──
      const btnR = 38
      // Shadow
      ctx.shadowColor = 'rgba(0,0,0,0.5)'
      ctx.shadowBlur = 12
      const btnGrad = ctx.createRadialGradient(cx - 6, cy - 6, 0, cx, cy, btnR)
      btnGrad.addColorStop(0, '#5a0090')
      btnGrad.addColorStop(1, '#1a0b35')
      ctx.beginPath()
      ctx.arc(cx, cy, btnR, 0, Math.PI * 2)
      ctx.fillStyle = btnGrad
      ctx.fill()
      ctx.shadowBlur = 0

      ctx.strokeStyle = '#ffe600'
      ctx.lineWidth = 3
      ctx.stroke()

      // Spin text inside button
      ctx.fillStyle = '#ffe600'
      ctx.font = `bold 13px 'Segoe UI', sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(isSpinning ? '⟳' : readOnly ? '👁' : 'SPIN', cx, cy)
    },
    [participants, winnerCount, isSpinning, readOnly]
  )

  // Redraw on data/state change
  useEffect(() => {
    draw(rotationRef.current)
  }, [draw, externalWinners])

  // ────────────────────────────────────────────────────────────
  // Canvas sizing (responsive)
  // ────────────────────────────────────────────────────────────
  useEffect(() => {
    const resizeObserver = new ResizeObserver(() => {
      const container = containerRef.current
      const canvas = canvasRef.current
      if (!container || !canvas) return
      // Use clientWidth (reliable on iOS Safari) instead of innerWidth
      const vw = document.documentElement.clientWidth || window.innerWidth
      const safeMax = Math.min(vw - 48, 560)
      const rawWidth = container.offsetWidth
      const size = rawWidth > 0 && rawWidth <= vw ? Math.min(rawWidth, safeMax) : safeMax
      // Set container to square
      container.style.width = `${size}px`
      container.style.height = `${size}px`
      // Set canvas to exactly size (no DPR scaling — draw() uses canvas.width as coordinate space)
      canvas.width = size
      canvas.height = size
      canvas.style.width = `${size}px`
      canvas.style.height = `${size}px`
      draw(rotationRef.current)
    })
    if (containerRef.current) resizeObserver.observe(containerRef.current)
    return () => resizeObserver.disconnect()
  }, [draw])

  // ────────────────────────────────────────────────────────────
  // Animation helpers
  // ────────────────────────────────────────────────────────────
  const stopAnimation = () => {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current)
      animRef.current = null
    }
  }

  const runEasedSpin = useCallback(
    (startRotation, targetRotation, duration, startTimestamp, onDone) => {
      const animate = (ts) => {
        const elapsed = ts - startTimestamp
        const progress = Math.min(elapsed / duration, 1)
        const eased = easeOutQuint(progress)
        const current = startRotation + (targetRotation - startRotation) * eased
        rotationRef.current = current
        draw(current)

        if (progress < 1) {
          animRef.current = requestAnimationFrame(animate)
        } else {
          rotationRef.current = targetRotation
          onDone && onDone(targetRotation)
        }
      }
      animRef.current = requestAnimationFrame(animate)
    },
    [draw]
  )

  // Inertia spin (from drag release)
  const runInertiaSpin = useCallback(
    (initialVelocity) => {
      let vel = initialVelocity
      const friction = 0.975

      const animate = () => {
        vel *= friction
        rotationRef.current += vel
        draw(rotationRef.current)

        if (Math.abs(vel) > 0.0008) {
          animRef.current = requestAnimationFrame(animate)
        } else {
          const w = calculateWinners(rotationRef.current, participants.length, winnerCount)
          setWinners(w)
          setIsSpinning(false)
          draw(rotationRef.current, w)
          onSpinComplete?.(w.map((i) => participants[i]))
        }
      }
      animRef.current = requestAnimationFrame(animate)
    },
    [draw, participants, winnerCount, onSpinComplete]
  )

  // ────────────────────────────────────────────────────────────
  // Exposed imperative handle
  // ────────────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    // Called by WheelScreen to trigger spin
    spin(targetRotation, duration) {
      stopAnimation()
      setWinners([])
      setIsSpinning(true)
      const startRotation = rotationRef.current
      const startTs = performance.now()
      runEasedSpin(startRotation, targetRotation, duration, startTs, (finalRot) => {
        const w = calculateWinners(finalRot, participants.length, winnerCount)
        setWinners(w)
        setIsSpinning(false)
        draw(finalRot, w)
        onSpinComplete?.(w.map((i) => participants[i]))
      })
    },
    // Called by LiveView to replay the same animation
    replaySpin(startRotation, targetRotation, duration, serverStartTime) {
      stopAnimation()
      setWinners([])
      setIsSpinning(true)
      rotationRef.current = startRotation
      const now = performance.now()
      const elapsed = Date.now() - serverStartTime
      const adjustedStart = startRotation + (targetRotation - startRotation) * easeOutQuint(Math.min(elapsed / duration, 1))
      const remainingDuration = Math.max(0, duration - elapsed)
      runEasedSpin(adjustedStart, targetRotation, remainingDuration, now, (finalRot) => {
        const w = calculateWinners(finalRot, participants.length, winnerCount)
        setWinners(w)
        setIsSpinning(false)
        draw(finalRot, w)
      })
    },
    setRotation(r) {
      rotationRef.current = r
      draw(r)
    },
    showWinners(winnerIdxs) {
      setWinners(winnerIdxs)
      draw(rotationRef.current, winnerIdxs)
    },
    getRotation: () => rotationRef.current,
    getIsSpinning: () => isSpinning,
  }))

  // ────────────────────────────────────────────────────────────
  // Drag-to-spin interaction
  // ────────────────────────────────────────────────────────────
  const getAngleFromCenter = (clientX, clientY) => {
    const canvas = canvasRef.current
    if (!canvas) return 0
    const rect = canvas.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    return Math.atan2(clientY - cy, clientX - cx)
  }

  const isOnCenterButton = (clientX, clientY) => {
    const canvas = canvasRef.current
    if (!canvas) return false
    const rect = canvas.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const dist = Math.hypot(clientX - cx, clientY - cy)
    const btnR = (38 / 600) * rect.width
    return dist < btnR
  }

  const handlePointerDown = useCallback(
    (e) => {
      if (readOnly || isSpinning) return
      if (isOnCenterButton(e.clientX, e.clientY)) return
      e.preventDefault()
      stopAnimation()
      isDraggingRef.current = true
      velocityBufferRef.current = []
      dragDataRef.current = {
        lastAngle: getAngleFromCenter(e.clientX, e.clientY),
        lastTime: performance.now(),
      }
      canvasRef.current?.setPointerCapture(e.pointerId)
    },
    [readOnly, isSpinning]
  )

  const handlePointerMove = useCallback(
    (e) => {
      if (!isDraggingRef.current) return
      const angle = getAngleFromCenter(e.clientX, e.clientY)
      const prev = dragDataRef.current.lastAngle
      let delta = angle - prev

      // Wrap around -π to π
      if (delta > Math.PI) delta -= Math.PI * 2
      if (delta < -Math.PI) delta += Math.PI * 2

      rotationRef.current += delta
      draw(rotationRef.current)

      const now = performance.now()
      const dt = now - dragDataRef.current.lastTime || 16
      velocityBufferRef.current.push(delta / dt)
      if (velocityBufferRef.current.length > 5) velocityBufferRef.current.shift()

      dragDataRef.current.lastAngle = angle
      dragDataRef.current.lastTime = now
    },
    [draw]
  )

  const handlePointerUp = useCallback(() => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false

    const buf = velocityBufferRef.current
    if (buf.length === 0) return

    const avgVel = buf.reduce((a, b) => a + b, 0) / buf.length
    const frameVel = avgVel * 16 // scale to per-frame ~60fps

    if (Math.abs(frameVel) > 0.005) {
      setWinners([])
      setIsSpinning(true)
      runInertiaSpin(frameVel)
    }
  }, [runInertiaSpin])

  // Click center button to spin
  const handleClick = useCallback(
    (e) => {
      if (readOnly || isSpinning) return
      if (!isOnCenterButton(e.clientX, e.clientY)) return
      // Trigger spin via parent — emit custom event
      canvasRef.current?.dispatchEvent(new CustomEvent('center-click', { bubbles: true }))
    },
    [readOnly, isSpinning]
  )

  return (
    <div ref={containerRef} className="wheel-container">
      <canvas
        ref={canvasRef}
        className={`wheel-canvas ${isSpinning ? 'spinning' : ''} ${readOnly ? 'readonly' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleClick}
        style={{ touchAction: 'none', cursor: readOnly ? 'default' : isSpinning ? 'wait' : 'grab' }}
      />
    </div>
  )
})

export default WheelCanvas
