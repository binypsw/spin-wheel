import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

export default function LiveModal({ roomId, isLive, viewerCount, onStartLive, onStopLive, onClose }) {
  const [copied, setCopied] = useState(false)

  const liveUrl = `${window.location.origin}?room=${roomId}`

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(liveUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
      const el = document.createElement('textarea')
      el.value = liveUrl
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📡 Live Streaming</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {!isLive ? (
            <div className="live-start-section">
              <p>เริ่ม Live เพื่อให้ผู้ชม join และดูการหมุนวงล้อแบบ real-time</p>
              <button className="btn-start-live" onClick={onStartLive}>
                🔴 เริ่ม Live
              </button>
            </div>
          ) : (
            <>
              <div className="live-status">
                <span className="live-dot" />
                <span>กำลัง Live อยู่</span>
                <span className="viewer-count">👥 {viewerCount} คนกำลังดู</span>
              </div>

              <div className="qr-section">
                <p className="qr-label">แสกน QR Code เพื่อเข้าดู</p>
                <div className="qr-wrapper">
                  <QRCodeSVG
                    value={liveUrl}
                    size={180}
                    bgColor="#ffffff"
                    fgColor="#1e293b"
                    level="M"
                    includeMargin
                  />
                </div>
              </div>

              <div className="link-section">
                <p className="qr-label">หรือแชร์ลิ้งก์นี้</p>
                <div className="link-row">
                  <input
                    type="text"
                    readOnly
                    value={liveUrl}
                    onClick={(e) => e.target.select()}
                  />
                  <button className={`btn-copy ${copied ? 'copied' : ''}`} onClick={copyLink}>
                    {copied ? '✓ คัดลอกแล้ว' : 'คัดลอก'}
                  </button>
                </div>
              </div>

              <div className="live-info-box">
                <span>ℹ️</span>
                <span>ผู้ชมจะเห็นวงล้อเหมือนกัน แต่ไม่สามารถหมุนหรือแก้ไขได้</span>
              </div>

              <button className="btn-stop-live" onClick={onStopLive}>
                ⏹ หยุด Live
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
