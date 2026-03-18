import { useState } from 'react'

export default function SetupScreen({ onStart }) {
  const [eventName, setEventName] = useState('')
  const [participantsText, setParticipantsText] = useState('')
  const [winnerCount, setWinnerCount] = useState(1)
  const [removeWinner, setRemoveWinner] = useState(true)
  const [errors, setErrors] = useState({})

  const getParticipants = () =>
    participantsText
      .split('\n')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)

  const validate = () => {
    const errs = {}
    if (!eventName.trim()) errs.eventName = 'กรุณาใส่ชื่อกิจกรรม'
    const participants = getParticipants()
    if (participants.length < 2) errs.participants = 'กรุณาใส่ชื่ออย่างน้อย 2 คน'
    if (winnerCount < 1) errs.winnerCount = 'จำนวนผู้ได้รับรางวัลต้องมากกว่า 0'
    if (winnerCount > participants.length) errs.winnerCount = 'จำนวนผู้ได้รับรางวัลต้องไม่เกินจำนวนผู้เข้าร่วม'
    return errs
  }

  const handleStart = () => {
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    setErrors({})
    const participants = getParticipants()
    onStart({ eventName: eventName.trim(), participants, winnerCount, removeWinner })
  }

  const participants = getParticipants()
  const maxWinners = Math.max(1, participants.length)

  return (
    <div className="setup-screen">
      <div className="bunting-row" aria-hidden="true">
        {['#cc1122','#e87020','#e8c800','#22aa44','#2266cc','#cc1122','#e87020','#e8c800','#22aa44','#2266cc','#cc1122','#e87020','#e8c800'].map((color, i) => (
          <span key={i} className="bunting-flag" style={{ borderBottomColor: color }} />
        ))}
      </div>
      <div className="setup-card">
        <div className="setup-header">
          <img src="/dragon.png" alt="logo" className="setup-icon" />
          <h1>Spin Wheel Lucky Draw</h1>
          <p>ตั้งค่าการชิงโชคของคุณ</p>
        </div>

        <div className="form-group">
          <label>ชื่อกิจกรรม</label>
          <input
            type="text"
            placeholder="เช่น วันครบรอบบริษัท, งานเลี้ยงสังสรรค์..."
            value={eventName}
            onChange={(e) => { setEventName(e.target.value); setErrors((p) => ({ ...p, eventName: '' })) }}
            className={errors.eventName ? 'error' : ''}
          />
          {errors.eventName && <span className="error-msg">{errors.eventName}</span>}
        </div>

        <div className="form-group">
          <label>
            รายชื่อผู้เข้าร่วม
            {participants.length > 0 && (
              <span className="participant-count">{participants.length} คน</span>
            )}
          </label>
          <textarea
            placeholder={'ใส่ชื่อทีละบรรทัด\nเช่น\nสมชาย\nสมหญิง\nสมศักดิ์'}
            value={participantsText}
            onChange={(e) => { setParticipantsText(e.target.value); setErrors((p) => ({ ...p, participants: '' })) }}
            rows={8}
            className={errors.participants ? 'error' : ''}
          />
          {errors.participants && <span className="error-msg">{errors.participants}</span>}
        </div>

        <div className="form-section-title">ตัวเลือกการหมุน</div>

        <div className="options-grid">
          <div className="form-group">
            <label>จำนวนผู้ได้รับรางวัลต่อ 1 การหมุน</label>
            <div className="number-input-row">
              <button
                className="num-btn"
                onClick={() => setWinnerCount((v) => Math.max(1, v - 1))}
                disabled={winnerCount <= 1}
              >−</button>
              <input
                type="number"
                min={1}
                max={maxWinners}
                value={winnerCount}
                onChange={(e) => {
                  const v = parseInt(e.target.value) || 1
                  setWinnerCount(Math.min(Math.max(1, v), maxWinners))
                  setErrors((p) => ({ ...p, winnerCount: '' }))
                }}
                className={errors.winnerCount ? 'error' : ''}
              />
              <button
                className="num-btn"
                onClick={() => setWinnerCount((v) => Math.min(maxWinners, v + 1))}
                disabled={winnerCount >= maxWinners}
              >+</button>
            </div>
            {errors.winnerCount && <span className="error-msg">{errors.winnerCount}</span>}
            {winnerCount > 1 && (
              <span className="hint">จะมี {winnerCount} เข็มชี้บนวงล้อ</span>
            )}
          </div>

          <div className="form-group">
            <label>กฎการหมุน</label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={removeWinner}
                onChange={(e) => setRemoveWinner(e.target.checked)}
              />
              <span>นำผู้ได้รับรางวัลออกจากวงล้อหลังจากหมุน</span>
            </label>
            <span className="hint">
              {removeWinner
                ? 'ผู้ที่ได้รับรางวัลแล้วจะไม่ถูกสุ่มซ้ำ'
                : 'ผู้เข้าร่วมทุกคนมีสิทธิ์ถูกสุ่มซ้ำได้'}
            </span>
          </div>
        </div>

        <button className="btn-start" onClick={handleStart}>
          เริ่มหมุนวงล้อ 🎯
        </button>

        <button
          className="btn-test"
          onClick={() => {
            setEventName('ทดสอบ 40 คน')
            setParticipantsText('สมชาย\nสมหญิง\nวิชัย\nนภา\nประวิทย์\nกนกวรรณ\nอนุชา\nมาลี\nธนากร\nรัตนา\nพิชัย\nวรรณา\nสุรชัย\nนิตยา\nปรีชา\nศิริพร\nชัยวัฒน์\nสุภาพร\nอภิชาต\nพรทิพย์\nวีระ\nสาวิตรี\nเกรียงศักดิ์\nลลิตา\nธีรวัฒน์\nสุนิสา\nภานุ\nกาญจนา\nสิทธิชัย\nพัชรี\nนพดล\nวิภาวดี\nประสิทธิ์\nอมรรัตน์\nเจษฎา\nกัลยาณี\nยุทธนา\nรุจิรา\nณัฐพล\nจิราภรณ์')
            setErrors({})
          }}
        >
          🧪 ทดสอบ 40 คน
        </button>
      </div>
    </div>
  )
}
