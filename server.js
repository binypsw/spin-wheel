const express = require('express')
const { WebSocketServer } = require('ws')
const { createServer } = require('http')
const path = require('path')

const app = express()
const server = createServer(app)

// WebSocket server on /ws path
const wss = new WebSocketServer({ server, path: '/ws' })

// rooms: Map<roomId, { host: ws|null, viewers: Set<ws>, state: object|null, cleanupTimer: any }>
const rooms = new Map()
const ROOM_TTL_MS = 30 * 60 * 1000 // keep room state for 30 mins after everyone leaves

function scheduleRoomCleanup(roomId) {
  const room = rooms.get(roomId)
  if (!room) return
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer)
  room.cleanupTimer = setTimeout(() => {
    const r = rooms.get(roomId)
    if (r && !r.host && r.viewers.size === 0) {
      rooms.delete(roomId)
    }
  }, ROOM_TTL_MS)
}

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { host: null, viewers: new Set(), state: null })
  }
  return rooms.get(roomId)
}

function broadcast(room, message, excludeWs = null) {
  const data = JSON.stringify(message)
  room.viewers.forEach((viewer) => {
    if (viewer !== excludeWs && viewer.readyState === 1) {
      viewer.send(data)
    }
  })
}

wss.on('connection', (ws) => {
  let currentRoomId = null
  let isHost = false

  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch { return }

    if (msg.type === 'join') {
      const { roomId, role } = msg
      currentRoomId = roomId
      isHost = role === 'host'
      const room = getOrCreateRoom(roomId)

      if (isHost) {
        room.host = ws
        ws.send(JSON.stringify({ type: 'joined', role: 'host', roomId }))
      } else {
        room.viewers.add(ws)
        ws.send(JSON.stringify({ type: 'joined', role: 'viewer', roomId }))
        // Send current state to new viewer
        if (room.state) {
          ws.send(JSON.stringify({ type: 'full_state', data: room.state }))
        }
        // Notify host of viewer count
        if (room.host && room.host.readyState === 1) {
          room.host.send(JSON.stringify({ type: 'viewer_count', count: room.viewers.size }))
        }
      }
    }

    // Host sends state updates — broadcast to all viewers
    if (msg.type === 'state_update' && isHost && currentRoomId) {
      const room = rooms.get(currentRoomId)
      if (!room) return
      room.state = msg.data
      broadcast(room, { type: 'full_state', data: msg.data })
    }

    // Host sends a spin event — broadcast to viewers with timing info
    if (msg.type === 'spin_start' && isHost && currentRoomId) {
      const room = rooms.get(currentRoomId)
      if (!room) return
      // Store in state
      if (!room.state) room.state = {}
      room.state.spinEvent = msg.data
      room.state.spinEvent.serverTime = Date.now()
      broadcast(room, { type: 'spin_start', data: room.state.spinEvent })
    }

    if (msg.type === 'spin_end' && isHost && currentRoomId) {
      const room = rooms.get(currentRoomId)
      if (!room) return
      if (!room.state) room.state = {}
      room.state.rotation = msg.data.rotation
      room.state.winners = msg.data.winners
      room.state.spinEvent = null
      broadcast(room, { type: 'spin_end', data: msg.data })
    }
  })

  ws.on('close', () => {
    if (!currentRoomId) return
    const room = rooms.get(currentRoomId)
    if (!room) return
    if (isHost) {
      room.host = null
      broadcast(room, { type: 'host_disconnected' })
    } else {
      room.viewers.delete(ws)
      if (room.host && room.host.readyState === 1) {
        room.host.send(JSON.stringify({ type: 'viewer_count', count: room.viewers.size }))
      }
    }
    // Schedule cleanup — keep state alive for a while in case of reconnect
    if (!room.host && room.viewers.size === 0) {
      scheduleRoomCleanup(currentRoomId)
    }
  })
})

// Serve static files in production
app.use(express.static(path.join(__dirname, 'dist')))
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

const PORT = process.env.PORT || 3456
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
