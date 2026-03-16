import { useRef, useState, useEffect, useCallback } from 'react'
import WheelCanvas, { calculateWinners } from './WheelCanvas'
import LiveModal from './LiveModal'

function generateRoomId() {
  return Math.random().toString(36).substring(2, 10).toUpperCase()
}

export default function WheelScreen({ config, onBack }) {
  const { eventName, removeWinner } = config
  const [participants, setParticipants] = useState(config.participants)
  const [winnerCount, setWinnerCount] = useState(config.winnerCount)
  const [winners, setWinners] = useState([])           // names of current spin winners
  const [rounds, setRounds] = useState([])             // [{round, winners:[]}]
  const [isSpinning, setIsSpinning] = useState(false)
  const [showWinnerModal, setShowWinnerModal] = useState(false)
  const [showLiveModal, setShowLiveModal] = useState(false)
  const [viewerCount, setViewerCount] = useState(0)
  const [isLive, setIsLive] = useState(false)
  const [roomId] = useState(() => generateRoomId())

  const wheelRef = useRef(null)
  const wsRef = useRef(null)

  // ────────────────────────────────────────────────────────────
  // WebSocket live connection (host)
  // ────────────────────────────────────────────────────────────
  const connectLive = useCallback(() => {
    if (wsRef.current) return
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setIsLive(true)
      ws.send(JSON.stringify({ type: 'join', roomId, role: 'host' }))
      // Send initial config
      ws.send(JSON.stringify({
        type: 'state_update',
        data: { eventName, participants, winnerCount, rounds, winners: [] },
      }))
    }
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'viewer_count') setViewerCount(msg.count)
    }
    ws.onclose = () => {
      setIsLive(false)
      setViewerCount(0)
      wsRef.current = null
    }
    ws.onerror = () => ws.close()
  }, [roomId, eventName, participants, winnerCount, rounds])

  const disconnectLive = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
  }, [])

  // Broadcast state to viewers whenever participants/winners change
  useEffect(() => {
    if (!isLive || !wsRef.current || wsRef.current.readyState !== 1) return
    wsRef.current.send(JSON.stringify({
      type: 'state_update',
      data: { eventName, participants, winnerCount, rounds, winners },
    }))
  }, [participants, winners, rounds, isLive, eventName, winnerCount])

  // ────────────────────────────────────────────────────────────
  // Spin logic
  // ────────────────────────────────────────────────────────────
  const handleSpin = useCallback(() => {
    if (isSpinning || participants.length < 2) return
    setIsSpinning(true)
    setWinners([])
    setShowWinnerModal(false)

    const currentRotation = wheelRef.current?.getRotation() ?? 0
    const extraSpins = (5 + Math.random() * 5) * Math.PI * 2
    const randomOffset = Math.random() * Math.PI * 2
    const targetRotation = currentRotation + extraSpins + randomOffset
    const duration = 4000 + Math.random() * 2000

    // Notify live viewers
    if (isLive && wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({
        type: 'spin_start',
        data: {
          startRotation: currentRotation,
          targetRotation,
          duration,
          serverTime: Date.now(),
        },
      }))
    }

    wheelRef.current?.spin(targetRotation, duration)
  }, [isSpinning, participants, isLive])

  const handleSpinComplete = useCallback((winnerNames) => {
    setIsSpinning(false)
    setWinners(winnerNames)
    setShowWinnerModal(true)

    const rotation = wheelRef.current?.getRotation() ?? 0
    const winnerIdxs = calculateWinners(rotation, participants.length, winnerCount)

    // Notify live viewers of result
    if (isLive && wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({
        type: 'spin_end',
        data: { rotation, winners: winnerIdxs },
      }))
    }

    setRounds((prev) => [...prev, { round: prev.length + 1, winners: winnerNames }])

    if (removeWinner) {
      setParticipants((prev) => prev.filter((p) => !winnerNames.includes(p)))
    }
  }, [participants, winnerCount, removeWinner, isLive])

  // Listen for center-click from canvas
  useEffect(() => {
    const canvas = document.querySelector('.wheel-canvas')
    if (!canvas) return
    const handler = () => handleSpin()
    canvas.addEventListener('center-click', handler)
    return () => canvas.removeEventListener('center-click', handler)
  }, [handleSpin])

  const handleReset = () => {
    setParticipants(config.participants)
    setWinners([])
    setRounds([])
    setShowWinnerModal(false)
    setIsSpinning(false)
    setWinnerCount(config.winnerCount)
  }

  const allWinnersFlat = rounds.flatMap((r) => r.winners)
  const canSpin = participants.length >= 1 && !isSpinning

  return (
    <div className="wheel-screen">
      {/* Header */}
      <div className="wheel-header">
        <button className="btn-icon" onClick={onBack} title="กลับไปตั้งค่า">
          ← ตั้งค่า
        </button>
        <div className="event-title">
          <span>🎡</span>
          <span>{eventName}</span>
        </div>
        <div className="header-actions">
          {isLive && (
            <span className="live-badge">
              🔴 LIVE · {viewerCount} คนดู
            </span>
          )}
          <button
            className={`btn-live ${isLive ? 'btn-live-active' : ''}`}
            onClick={() => setShowLiveModal(true)}
          >
            {isLive ? '📡 จัดการ Live' : '📡 เริ่ม Live'}
          </button>
        </div>
      </div>

      <div className="wheel-layout">
        {/* Left panel */}
        <div className="wheel-left">
          <div className="participants-panel">
            <div className="panel-title">
              ผู้เข้าร่วม <span className="badge">{participants.length}</span>
            </div>
            <ul className="participants-list">
              {participants.map((p, i) => (
                <li key={i} className={winners.includes(p) ? 'winner-item' : ''}>
                  <span className="rank">{i + 1}</span>
                  <span>{p}</span>
                  {winners.includes(p) && <span className="winner-star">🏆</span>}
                </li>
              ))}
              {participants.length === 0 && (
                <li className="empty-list">ไม่มีผู้เข้าร่วมเหลืออยู่</li>
              )}
            </ul>
          </div>

          {rounds.length > 0 && (
            <div className="all-winners-panel">
              <div className="panel-title">ผลการจับรางวัล</div>
              {rounds.map((r) => (
                <div key={r.round} className="round-group">
                  <div className="round-title">ครั้งที่ {r.round}</div>
                  <ul className="all-winners-list">
                    {r.winners.map((w, i) => (
                      <li key={i}>
                        <span className="winner-star">🏆</span>
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Center — Wheel */}
        <div className="wheel-center">
          <WheelCanvas
            ref={wheelRef}
            participants={participants}
            winnerCount={winnerCount}
            onSpinComplete={handleSpinComplete}
          />

          {/* Winner count adjuster */}
          <div className="winner-count-adjuster">
            <span className="winner-count-label">
              ผู้ถูกรางวัลรอบนี้
            </span>
            <div className="winner-count-controls">
              <button
                className="num-btn"
                onClick={() => setWinnerCount((v) => Math.max(1, v - 1))}
                disabled={winnerCount <= 1 || isSpinning}
              >−</button>
              <span className="winner-count-value">{winnerCount} คน</span>
              <button
                className="num-btn"
                onClick={() => setWinnerCount((v) => Math.min(participants.length, v + 1))}
                disabled={winnerCount >= participants.length || isSpinning}
              >+</button>
            </div>
          </div>

          <div className="spin-controls">
            <button
              className="btn-spin"
              onClick={handleSpin}
              disabled={!canSpin}
            >
              {isSpinning ? '⟳ กำลังหมุน...' : '🎯 หมุนวงล้อ!'}
            </button>
            <button className="btn-reset" onClick={handleReset} title="รีเซ็ต">
              ↺ รีเซ็ต
            </button>
          </div>
          <p className="drag-hint">
            {isSpinning
              ? 'รอผล...'
              : 'กดปุ่ม SPIN ตรงกลาง หรือ ลากหมุนวงล้อด้วยมือ'}
          </p>
        </div>

        {/* Right panel — winner count info */}
        <div className="wheel-right">
          <div className="info-panel">
            <div className="panel-title">ข้อมูลการหมุน</div>
            <div className="info-item">
              <span>จำนวนผู้เข้าร่วม</span>
              <strong>{participants.length}</strong>
            </div>
            <div className="info-item">
              <span>รางวัลต่อการหมุน</span>
              <strong>{winnerCount} คน</strong>
            </div>
            <div className="info-item">
              <span>รับรางวัลแล้ว</span>
              <strong>{allWinnersFlat.length} คน</strong>
            </div>
            <div className="info-item">
              <span>กฎ</span>
              <strong>{removeWinner ? 'ไม่ซ้ำ' : 'ซ้ำได้'}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Winner announcement modal */}
      {showWinnerModal && winners.length > 0 && (
        <div className="winner-overlay" onClick={() => setShowWinnerModal(false)}>
          <div className="winner-modal" onClick={(e) => e.stopPropagation()}>
            <div className="winner-modal-header">
              🎉 ผู้ได้รับรางวัล! 🎉
            </div>
            <div className="winner-names">
              {winners.map((w, i) => (
                <div key={i} className="winner-name-item">
                  <span className="winner-trophy">🏆</span>
                  <span>{w}</span>
                </div>
              ))}
            </div>
            <div className="winner-modal-footer">
              <button
                className="btn-continue"
                onClick={() => setShowWinnerModal(false)}
              >
                ดำเนินการต่อ
              </button>
              {participants.length >= 1 && canSpin && (
                <button
                  className="btn-spin-again"
                  onClick={() => { setShowWinnerModal(false); setTimeout(handleSpin, 100) }}
                >
                  หมุนอีกครั้ง
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Live modal */}
      {showLiveModal && (
        <LiveModal
          roomId={roomId}
          isLive={isLive}
          viewerCount={viewerCount}
          onStartLive={connectLive}
          onStopLive={disconnectLive}
          onClose={() => setShowLiveModal(false)}
        />
      )}
    </div>
  )
}
