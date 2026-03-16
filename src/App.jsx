import { useState } from 'react'
import SetupScreen from './components/SetupScreen'
import WheelScreen from './components/WheelScreen'
import LiveView from './components/LiveView'

export default function App() {
  const [screen, setScreen] = useState('setup')
  const [config, setConfig] = useState(null)

  // Check if this is a live viewer URL
  const params = new URLSearchParams(window.location.search)
  const roomId = params.get('room')
  if (roomId) {
    return <LiveView roomId={roomId} />
  }

  const handleStart = (cfg) => {
    setConfig(cfg)
    setScreen('wheel')
  }

  const handleBack = () => {
    setScreen('setup')
  }

  if (screen === 'setup') {
    return <SetupScreen onStart={handleStart} />
  }

  return <WheelScreen config={config} onBack={handleBack} />
}
