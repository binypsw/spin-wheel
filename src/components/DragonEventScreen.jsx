import { useState, useRef, useCallback, useEffect } from 'react'
import WheelCanvas from './WheelCanvas'
import LiveModal from './LiveModal'

const BUNTING = ['#cc1122','#e87020','#e8c800','#22aa44','#2266cc','#cc1122','#e87020','#e8c800','#22aa44','#2266cc','#cc1122','#e87020','#e8c800','#22aa44','#2266cc','#cc1122','#e87020','#e8c800']

function generateRoomId() {
  return Math.random().toString(36).substring(2, 10).toUpperCase()
}

export default function DragonEventScreen({ onBack }) {
  const [loading, setLoading]                   = useState(true)
  const [error, setError]                       = useState(null)
  const [brands, setBrands]                     = useState([])
  const [tierParticipants, setTierParticipants] = useState({})
  const [currentIndex, setCurrentIndex]         = useState(0)
  const [winnersPerTier, setWinnersPerTier]     = useState({})
  const [results, setResults]                   = useState([])
  const [isSpinning, setIsSpinning]             = useState(false)
  const [currentWinners, setCurrentWinners]     = useState([])
  const [showModal, setShowModal]               = useState(false)
  const [showDoneModal, setShowDoneModal]       = useState(false)  // Fix 5
  const [saving, setSaving]                     = useState(false)
  // Live
  const [isLive, setIsLive]                     = useState(false)
  const [viewerCount, setViewerCount]           = useState(0)
  const [showLiveModal, setShowLiveModal]       = useState(false)
  const [roomId]                                = useState(() => generateRoomId())

  const wheelRef      = useRef(null)
  const wsRef         = useRef(null)
  const resultsEndRef = useRef(null)

  // ── โหลดข้อมูล ──────────────────────────────────────────
  useEffect(() => {
    fetch('/api/dragon/data')
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setBrands(data.brands)
        setTierParticipants(data.tierParticipants)
        setLoading(false)
      })
      .catch(err => { setError(err.message); setLoading(false) })
  }, [])

  // ── auto-scroll ผลล่างสุดเสมอ ────────────────────────────
  useEffect(() => {
    resultsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [results])

  // ── Live ─────────────────────────────────────────────────
  const connectLive = useCallback(() => {
    if (wsRef.current) return
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`)
    wsRef.current = ws
    ws.onopen = () => {
      setIsLive(true)
      ws.send(JSON.stringify({ type: 'join', roomId, role: 'host' }))
    }
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'viewer_count') setViewerCount(msg.count)
    }
    ws.onclose = () => { setIsLive(false); setViewerCount(0); wsRef.current = null }
    ws.onerror  = () => ws.close()
  }, [roomId])

  const disconnectLive = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
  }, [])

  const broadcastState = useCallback((overrides = {}) => {
    if (!isLive || !wsRef.current || wsRef.current.readyState !== 1) return
    const brand = brands[currentIndex]
    wsRef.current.send(JSON.stringify({
      type: 'state_update',
      data: {
        eventName: brand?.brand ?? 'กิจกรรมวันเกิดมังกรน้อยเมษา 69',
        participants: overrides.participants ?? [],
        winnerCount: overrides.winnerCount ?? 1,
        rounds: results.map(r => ({ round: r.brandName, winners: r.winners })),
        winners: overrides.winners ?? currentWinners,
        ...overrides,
      },
    }))
  }, [isLive, brands, currentIndex, results, currentWinners])

  // ── pool ผู้เข้าร่วม ──────────────────────────────────────
  const currentBrand = brands[currentIndex]

  const getEffectiveParticipants = useCallback((brand, tParticipants, wonPerTier) => {
    if (!brand) return []
    const pool = tParticipants[brand.tier]?.[brand.brand] ?? []
    if (brand.isIndividual) return pool
    const won = wonPerTier[brand.tier]
    if (!won || won.size === 0) return pool
    const filtered = pool.filter(p => !won.has(p))
    // กรณีพิเศษ: ตัดออกจนหมด → คืน pool ดั้งเดิม
    return filtered.length > 0 ? filtered : pool
  }, [])

  const participants = currentBrand
    ? getEffectiveParticipants(currentBrand, tierParticipants, winnersPerTier)
    : []

  const effectiveWinnerCount = currentBrand
    ? Math.min(currentBrand.quota, Math.max(1, participants.length))
    : 1

  useEffect(() => {
    broadcastState({ participants, winnerCount: effectiveWinnerCount })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants, effectiveWinnerCount, isLive])

  // ── Spin ─────────────────────────────────────────────────
  const handleSpin = useCallback(() => {
    if (isSpinning || participants.length < 1) return
    setIsSpinning(true)
    setCurrentWinners([])
    setShowModal(false)

    const currentRotation = wheelRef.current?.getRotation() ?? 0
    const extraSpins      = (5 + Math.random() * 5) * Math.PI * 2
    const randomOffset    = Math.random() * Math.PI * 2
    const targetRotation  = currentRotation + extraSpins + randomOffset
    const duration        = 4000 + Math.random() * 2000

    if (isLive && wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({
        type: 'spin_start',
        data: { startRotation: currentRotation, targetRotation, duration, serverTime: Date.now() },
      }))
    }

    wheelRef.current?.spin(targetRotation, duration)
  }, [isSpinning, participants, isLive])

  const handleSpinComplete = useCallback((winnerNames) => {
    setIsSpinning(false)
    setCurrentWinners(winnerNames)
    setShowModal(true)

    if (isLive && wsRef.current?.readyState === 1) {
      const rotation = wheelRef.current?.getRotation() ?? 0
      wsRef.current.send(JSON.stringify({
        type: 'spin_end',
        data: { rotation, winners: winnerNames },
      }))
    }
  }, [isLive])

  // ── ยืนยันผล ─────────────────────────────────────────────
  const handleConfirm = async () => {
    if (!currentBrand) return
    setSaving(true)

    const remainingQuota = Math.max(0, currentBrand.quota - currentWinners.length)

    try {
      await fetch('/api/dragon/record-winners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand: currentBrand.brand,
          tier: currentBrand.tier,
          winners: currentWinners,
          remainingQuota,
        }),
      })
    } catch (e) {
      console.error('Failed to record winners:', e)
    }

    if (!currentBrand.isIndividual && currentWinners.length > 0) {
      setWinnersPerTier(prev => {
        const newSet = new Set(prev[currentBrand.tier] || [])
        currentWinners.forEach(w => newSet.add(w))
        return { ...prev, [currentBrand.tier]: newSet }
      })
    }

    setResults(prev => [...prev, { brandName: currentBrand.brand, winners: currentWinners }])
    setShowModal(false)
    setSaving(false)
    setCurrentWinners([])

    // Fix 5: ถ้า brand สุดท้าย → แสดง done modal แทนการเลื่อน index ออกนอก array
    if (currentIndex + 1 >= brands.length) {
      setShowDoneModal(true)
    } else {
      setCurrentIndex(prev => prev + 1)
    }
  }

  // ── center-click ─────────────────────────────────────────
  useEffect(() => {
    const canvas = document.querySelector('.dragon-screen .wheel-canvas')
    if (!canvas) return
    const handler = () => handleSpin()
    canvas.addEventListener('center-click', handler)
    return () => canvas.removeEventListener('center-click', handler)
  }, [handleSpin])

  // ══════════════════════════════════════════════════════════
  //  Render
  // ══════════════════════════════════════════════════════════

  if (loading) return (
    <div className="dragon-screen dragon-state-screen">
      <div className="bunting-row" aria-hidden="true">
        {BUNTING.map((c, i) => <span key={i} className="bunting-flag" style={{ borderBottomColor: c }} />)}
      </div>
      <div className="dragon-state-content">
        <div className="dragon-state-icon">⏳</div>
        <div className="dragon-state-text">กำลังโหลดข้อมูลจาก Google Sheets...</div>
      </div>
    </div>
  )

  if (error) return (
    <div className="dragon-screen dragon-state-screen">
      <div className="bunting-row" aria-hidden="true">
        {BUNTING.map((c, i) => <span key={i} className="bunting-flag" style={{ borderBottomColor: c }} />)}
      </div>
      <div className="dragon-state-content">
        <div className="dragon-state-icon">❌</div>
        <div className="dragon-state-text">เกิดข้อผิดพลาด: {error}</div>
        <button className="btn-icon" onClick={onBack}>← กลับหน้าหลัก</button>
      </div>
    </div>
  )

  const noParticipants = participants.length === 0

  return (
    <div className="dragon-screen">
      <div className="bunting-row" aria-hidden="true">
        {BUNTING.map((c, i) => <span key={i} className="bunting-flag" style={{ borderBottomColor: c }} />)}
      </div>

      {/* Header — Fix 1: ไม่มี progress badge ที่นี่แล้ว */}
      <div className="wheel-header">
        <button className="btn-icon" onClick={onBack} title="กลับ">← กลับ</button>
        <div className="event-title" />
        <div className="header-actions">
          {/* Fix 2: live-badge อยู่ก่อน btn-live เสมอ */}
          {isLive && <span className="live-badge">🔴 LIVE · {viewerCount} คนดู</span>}
          <button
            className={`btn-live ${isLive ? 'btn-live-active' : ''}`}
            onClick={() => setShowLiveModal(true)}
          >
            {isLive ? '📡 จัดการ Live' : '📡 เริ่ม Live'}
          </button>
        </div>
      </div>

      {/* Fix 1: Brand Banner — progress badge อยู่ต่อจากชื่อ Brand */}
      <div className="dragon-brand-banner">
        <div className="dragon-brand-name-row">
          <div className="dragon-brand-name">{currentBrand.brand}</div>
          <span className="dragon-progress-inline">
            {currentIndex + 1} / {brands.length}
          </span>
        </div>
        <div className="dragon-brand-meta">
          <span className="dragon-meta-badge tier">{currentBrand.tier}</span>
          <span className="dragon-meta-badge quota">🏆 {currentBrand.quota} รางวัล</span>
          <span className="dragon-meta-badge people">👥 {participants.length} คน</span>
        </div>
      </div>

      {/* Layout หลัก */}
      <div className="wheel-layout dragon-wheel-layout">
        {/* Left: ผู้เข้าร่วม */}
        <div className="wheel-left">
          <div className="participants-panel">
            <div className="panel-title">
              ผู้เข้าร่วม <span className="badge">{participants.length}</span>
            </div>
            <ul className="participants-list">
              {participants.map((p, i) => (
                <li key={i}>
                  <span className="rank">{i + 1}</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Center: Wheel — Fix 4: key={currentIndex} รีเซ็ต internal state เมื่อ brand เปลี่ยน */}
        <div className="wheel-center">
          <WheelCanvas
            key={currentIndex}
            ref={wheelRef}
            participants={noParticipants ? ['—'] : participants}
            winnerCount={effectiveWinnerCount}
            onSpinComplete={handleSpinComplete}
          />
          <div className="spin-controls">
            <button
              className="btn-spin"
              onClick={handleSpin}
              disabled={isSpinning || noParticipants}
            >
              {isSpinning ? '⟳ กำลังหมุน...' : '🎯 หมุนวงล้อ!'}
            </button>
          </div>
          <p className="drag-hint">
            {isSpinning ? 'รอผล...' : 'กดปุ่ม SPIN ตรงกลาง หรือ ลากหมุนวงล้อด้วยมือ'}
          </p>
        </div>

        {/* Right: ผลการจับรางวัล */}
        <div className="wheel-right">
          <div className="all-winners-panel dragon-results-panel">
            <div className="panel-title">ผลการจับรางวัล</div>
            {results.length === 0 ? (
              <div className="dragon-no-results">ยังไม่มีผลการจับรางวัล</div>
            ) : (
              results.map((r, i) => (
                <div key={i} className="round-group">
                  <div className="round-title">🎁 {r.brandName}</div>
                  <ul className="all-winners-list">
                    {r.winners.map((w, j) => (
                      <li key={j}>
                        <span className="winner-star">🏆</span>
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
            <div ref={resultsEndRef} />
          </div>
        </div>
      </div>

      {/* Winner Modal */}
      {showModal && currentWinners.length > 0 && (
        <div className="winner-overlay">
          <div className="winner-modal" onClick={e => e.stopPropagation()}>
            <div className="winner-modal-header">🎉 ผู้ได้รับรางวัล! 🎉</div>
            <div className="dragon-modal-brand">🎁 {currentBrand?.brand}</div>
            <div className="winner-names">
              {currentWinners.map((w, i) => (
                <div key={i} className="winner-name-item">
                  <span className="winner-trophy">🏆</span>
                  <span>{w}</span>
                </div>
              ))}
            </div>
            {currentBrand && currentWinners.length < currentBrand.quota && (
              <div className="dragon-quota-warn">
                ⚠️ ผู้เข้าร่วมไม่ครบโควต้า (ได้ {currentWinners.length}/{currentBrand.quota})
              </div>
            )}
            <div className="winner-modal-footer">
              <button className="btn-continue" onClick={handleConfirm} disabled={saving}>
                {saving ? '⏳ กำลังบันทึก...' : '✅ ยืนยัน & ไปต่อ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fix 5: Done Modal — แสดงเมื่อถึง brand สุดท้าย แทนการ redirect */}
      {showDoneModal && (
        <div className="winner-overlay">
          <div className="winner-modal dragon-done-modal" onClick={e => e.stopPropagation()}>
            <div className="winner-modal-header">🎉 สิ้นสุดกิจกรรม! 🎉</div>
            <div className="dragon-modal-brand">🐉 กิจกรรมวันเกิดมังกรน้อยเมษา 69</div>
            <div className="dragon-done-summary">
              จบการจับรางวัลครบทุก {brands.length} Brand แล้ว
            </div>
            <div className="dragon-done-result-list">
              {results.map((r, i) => (
                <div key={i} className="dragon-done-result-item">
                  <span className="dragon-done-brand-name">🎁 {r.brandName}</span>
                  <span className="dragon-done-winners">{r.winners.join(', ')}</span>
                </div>
              ))}
            </div>
            <div className="winner-modal-footer">
              <button className="btn-continue" onClick={() => setShowDoneModal(false)}>
                ✕ ปิด
              </button>
              <button className="btn-spin-again" onClick={onBack}>
                ← กลับหน้าหลัก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live Modal */}
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
