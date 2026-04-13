import { useState, useEffect } from 'react'
import SetupScreen from './components/SetupScreen'
import WheelScreen from './components/WheelScreen'
import LiveView from './components/LiveView'
import DragonEventScreen from './components/DragonEventScreen'

function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine)
  useEffect(() => {
    const on = () => setOffline(false)
    const off = () => setOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  if (!offline) return null
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: '#b45309', color: '#fff', textAlign: 'center',
      padding: '8px 16px', fontSize: '14px', fontWeight: 600,
    }}>
      📵 ออฟไลน์ — กำลังใช้งานแบบ offline (ฟีเจอร์ Live ไม่พร้อมใช้งาน)
    </div>
  )
}

export default function App() {
  const [screen, setScreen] = useState('setup')
  const [config, setConfig] = useState(null)

  // Check if this is a live viewer URL
  const params = new URLSearchParams(window.location.search)
  const roomId = params.get('room')
  if (roomId) {
    return (
      <>
        <OfflineBanner />
        <LiveView roomId={roomId} />
      </>
    )
  }

  const handleStart = (cfg) => {
    setConfig(cfg)
    setScreen(cfg.mode === 'dragon' ? 'dragon' : 'wheel')
  }

  const handleBack = () => {
    setScreen('setup')
  }

  if (screen === 'setup') {
    return (
      <>
        <OfflineBanner />
        <SetupScreen onStart={handleStart} />
      </>
    )
  }

  if (screen === 'dragon') {
    return (
      <>
        <OfflineBanner />
        <DragonEventScreen onBack={handleBack} />
      </>
    )
  }

  return (
    <>
      <OfflineBanner />
      <WheelScreen config={config} onBack={handleBack} />
    </>
  )
}
