import { useEffect, useRef, useState } from 'react'
import WheelCanvas from './WheelCanvas'

export default function LiveView({ roomId }) {
  const [config, setConfig] = useState(null)
  const [winners, setWinners] = useState([])
  const [allWinners, setAllWinners] = useState([])
  const [rounds, setRounds] = useState([])
  const [isConnected, setIsConnected] = useState(false)
  const [hostDisconnected, setHostDisconnected] = useState(false)
  const [showWinnerBanner, setShowWinnerBanner] = useState(false)
  const [currentWinnerNames, setCurrentWinnerNames] = useState([])
  const resultsEndRef = useRef(null)

  const wheelRef = useRef(null)
  const wsRef = useRef(null)
  const reconnectRef = useRef(null)

  const connect = () => {
    if (wsRef.current) return
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`)
    wsRef.current = ws

    ws.onopen = () => {
      setIsConnected(true)
      setHostDisconnected(false)
      ws.send(JSON.stringify({ type: 'join', roomId, role: 'viewer' }))
    }

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)

      if (msg.type === 'full_state') {
        const data = msg.data
        setConfig({
          eventName: data.eventName,
          participants: data.participants,
          winnerCount: data.winnerCount,
        })
        setAllWinners(data.allWinners || [])
        setRounds(data.rounds || [])
        setWinners(data.winners || [])
        if (data.rotation !== undefined) {
          wheelRef.current?.setRotation(data.rotation)
        }
        // If there's an ongoing spin, replay it
        if (data.spinEvent) {
          const { startRotation, targetRotation, duration, serverTime } = data.spinEvent
          wheelRef.current?.replaySpin(startRotation, targetRotation, duration, serverTime)
        }
      }

      if (msg.type === 'spin_start') {
        const { startRotation, targetRotation, duration, serverTime } = msg.data
        setWinners([])
        setShowWinnerBanner(false)
        wheelRef.current?.replaySpin(startRotation, targetRotation, duration, serverTime)
      }

      if (msg.type === 'spin_end') {
        const { rotation, winners: winnerIdxs } = msg.data
        wheelRef.current?.setRotation(rotation)
        wheelRef.current?.showWinners(winnerIdxs)

        // Show winner names from latest config
        setConfig((prev) => {
          if (!prev) return prev
          const names = winnerIdxs.map((i) => prev.participants[i]).filter(Boolean)
          setCurrentWinnerNames(names)
          setShowWinnerBanner(true)
          setAllWinners((aw) => {
            const next = [...aw]
            names.forEach((n) => { if (!next.includes(n)) next.push(n) })
            return next
          })
          if (names.length > 0) {
            setRounds((prev) => [...prev, { round: prev.length + 1, winners: names }])
          }
          return prev
        })
        setTimeout(() => setShowWinnerBanner(false), 6000)
      }

      if (msg.type === 'host_disconnected') {
        setHostDisconnected(true)
      }
    }

    ws.onclose = () => {
      setIsConnected(false)
      wsRef.current = null
      // Auto-reconnect
      reconnectRef.current = setTimeout(connect, 3000)
    }

    ws.onerror = () => ws.close()
  }

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectRef.current)
      wsRef.current?.close()
    }
  }, [])

  useEffect(() => {
    resultsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [rounds])

  if (!isConnected && !config) {
    return (
      <div className="live-connecting">
        <div className="connecting-spinner" />
        <h2>กำลังเชื่อมต่อ Live...</h2>
        <p>Room: {roomId}</p>
      </div>
    )
  }

  if (hostDisconnected) {
    return (
      <div className="live-connecting">
        <div style={{ fontSize: 64 }}>📴</div>
        <h2>Host ออกจาก Live แล้ว</h2>
        <p>รอ host กลับมาหรือปิดหน้าต่างนี้</p>
      </div>
    )
  }

  if (!config) {
    return (
      <div className="live-connecting">
        <div className="connecting-spinner" />
        <h2>รอรับข้อมูลจาก Host...</h2>
      </div>
    )
  }

  return (
    <div className="wheel-screen live-view">
      {/* Header */}
      <div className="wheel-header">
        <div className="event-title">
          <span>🎡</span>
          <span>{config.eventName}</span>
        </div>
        <div className="live-viewer-badge">
          <span className="live-dot" />
          <span>ดู Live</span>
          {!isConnected && <span className="reconnecting">กำลังเชื่อมต่อใหม่...</span>}
        </div>
      </div>

      <div className="wheel-layout">
        <div className="wheel-left">
          <div className="participants-panel">
            <div className="panel-title">
              ผู้เข้าร่วม <span className="badge">{config.participants.length}</span>
            </div>
            <ul className="participants-list">
              {config.participants.map((p, i) => (
                <li key={i}>
                  <span className="rank">{i + 1}</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="wheel-center">
          <WheelCanvas
            ref={wheelRef}
            participants={config.participants}
            winnerCount={config.winnerCount}
            readOnly
          />
          <p className="drag-hint live-hint">🔴 กำลังดู Live — ผู้ชม (Read Only)</p>
        </div>

        <div className="wheel-right">
          <div className="all-winners-panel dragon-results-panel">
            <div className="panel-title">ผลการจับรางวัล</div>
            <div className="dragon-results-scroll">
              {rounds.length === 0 ? (
                <div className="dragon-no-results">ยังไม่มีผลการจับรางวัล</div>
              ) : (
                rounds.map((r, i) => (
                  <div key={i} className="round-group">
                    <div className="round-title">🎁 {r.round}</div>
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
      </div>

      {/* Winner banner */}
      {showWinnerBanner && currentWinnerNames.length > 0 && (
        <div className="winner-overlay" onClick={() => setShowWinnerBanner(false)}>
          <div className="winner-modal">
            <div className="winner-modal-header">🎉 ผู้ได้รับรางวัล! 🎉</div>
            <div className="winner-names">
              {currentWinnerNames.map((w, i) => (
                <div key={i} className="winner-name-item">
                  <span className="winner-trophy">🏆</span>
                  <span>{w}</span>
                </div>
              ))}
            </div>
            <div className="winner-modal-footer">
              <button className="btn-continue" onClick={() => setShowWinnerBanner(false)}>
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
