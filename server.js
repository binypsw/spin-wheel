const express = require('express')
const { WebSocketServer } = require('ws')
const { createServer } = require('http')
const path = require('path')
const { google } = require('googleapis')

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

// ══════════════════════════════════════════════════════════
//  DRAGON EVENT — Google Sheets API
// ══════════════════════════════════════════════════════════
app.use(express.json())

const SPREADSHEET_ID = '1LdqQBrGTqoBdWyuafhHpaYZbEAkUkoeqfTp4Zd9j-zs'
const KEY_PATH = path.join(__dirname, 'src', 'key', 'composed-facet-357411-38348da8ae01.json')

const TIER_TO_SHEET = {
  'Premium': 'Premium',
  'Medium': 'Medium',
  'Basic1': 'Basic1',
  'Basic2': 'Basic2',
  'แพมเพิส': 'แพมเพิส',
  'Voucher': 'Voucher',
  'Sauce': 'Sauce',
  'ของเหลือ': 'ของเหลือ',
}
// Tab หลักสำหรับดึงข้อมูล brand
const CODE_BRAND_TAB = 'Code brand'

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  return google.sheets({ version: 'v4', auth })
}

// จับคู่ชื่อ brand — exact หรือ starts-with ทั้งสองทิศทาง
function brandMatch(a, b) {
  const al = a.toLowerCase().trim()
  const bl = b.toLowerCase().trim()
  return al === bl || al.startsWith(bl) || bl.startsWith(al)
}

let sheetMetaCache = null
async function getSheetMeta(sheets) {
  if (sheetMetaCache) return sheetMetaCache
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })
  sheetMetaCache = {}
  for (const s of meta.data.sheets) {
    sheetMetaCache[s.properties.title] = s.properties.sheetId
  }
  return sheetMetaCache
}

// GET /api/dragon/data — ดึงข้อมูล brand + ผู้เข้าร่วมทั้งหมดจาก Google Sheets
app.get('/api/dragon/data', async (req, res) => {
  sheetMetaCache = null
  try {
    const sheets = await getSheetsClient()

    // 1. ดึงข้อมูล brand จาก "Code brand"
    const brandRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${CODE_BRAND_TAB}!A:G`,
    })
    const rows = brandRes.data.values || []
    const brands = rows.slice(1)
      .filter(row => (row[5] || '').trim() === 'Yes')
      .map(row => ({
        brand: (row[0] || '').trim(),
        code: (row[1] || '').trim(),
        tier: (row[2] || '').trim(),
        quota: parseInt(row[3]) || 0,
        isIndividual: (row[4] || '').trim() === 'Yes',
        order: parseInt(row[6]) || 0,
      }))
      .filter(b => b.brand)
      .sort((a, b) => a.order - b.order)

    // 2. ดึงรายชื่อผู้เข้าร่วมจากแต่ละ tier tab
    const tiers = [...new Set(brands.map(b => b.tier))]
    const tierParticipants = {}

    for (const tier of tiers) {
      const tabName = TIER_TO_SHEET[tier] || tier
      try {
        // โครงสร้าง: Row 1 = brand names แนวนอน (A1, B1, C1...), Row 2+ = participants ต่อ column
        const tabRes = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `${tabName}!A:Z`,
        })
        const tabData = tabRes.data.values || []
        const tierBrandNames = brands.filter(b => b.tier === tier).map(b => b.brand)
        const headerRow = tabData[0] || []
        const sections = {}

        for (let col = 0; col < headerRow.length; col++) {
          const cleanHeader = (headerRow[col] || '').trim().replace(/\s*\(\d+\)\s*$/, '')
          const matched = tierBrandNames.find(bn => brandMatch(cleanHeader, bn))
          if (!matched) continue
          const participants = []
          for (let row = 1; row < tabData.length; row++) {
            const val = (tabData[row]?.[col] || '').trim()
            if (val) participants.push(val)
          }
          sections[matched] = participants
        }
        tierParticipants[tier] = sections
      } catch (e) {
        console.error(`Tab error tier="${tier}" tab="${tabName}":`, e.message)
        tierParticipants[tier] = {}
      }
    }

    res.json({ brands, tierParticipants })
  } catch (err) {
    console.error('Dragon data error:', err)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/dragon/record-winners — บันทึกผู้ชนะ (bold+green) และอัพเดทสถานะ brand
app.post('/api/dragon/record-winners', async (req, res) => {
  const { brand, tier, winners, remainingQuota } = req.body
  if (!brand || !tier || !Array.isArray(winners)) {
    return res.status(400).json({ error: 'Missing required fields' })
  }
  try {
    const sheets = await getSheetsClient()
    const meta = await getSheetMeta(sheets)
    const tabName = TIER_TO_SHEET[tier] || tier
    const sheetId = meta[tabName]
    const codeBrandSheetId = meta[CODE_BRAND_TAB]

    // โครงสร้าง: Row 1 = brand headers แนวนอน, Row 2+ = participants ต่อ column
    const tabRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${tabName}!A:Z`,
    })
    const tabData = tabRes.data.values || []
    const headerRow = tabData[0] || []

    // หา column index ของ brand นี้
    let brandCol = -1
    for (let col = 0; col < headerRow.length; col++) {
      const cleanHeader = (headerRow[col] || '').trim().replace(/\s*\(\d+\)\s*$/, '')
      if (brandMatch(cleanHeader, brand)) {
        brandCol = col
        break
      }
    }

    // หา cells ของผู้ชนะในคอลัมน์ของ brand นี้
    const winnerSet = new Set(winners)
    const winnerCells = [] // [{rowIdx, colIdx}]
    if (brandCol >= 0) {
      for (let row = 1; row < tabData.length; row++) {
        const val = (tabData[row]?.[brandCol] || '').trim()
        if (winnerSet.has(val)) winnerCells.push({ rowIdx: row, colIdx: brandCol })
      }
    }

    const requests = []

    // Format ผู้ชนะ: bold + สีเขียว
    if (sheetId !== undefined) {
      for (const { rowIdx, colIdx } of winnerCells) {
        requests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true, foregroundColor: { red: 0.133, green: 0.545, blue: 0.133 } },
              },
            },
            fields: 'userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.foregroundColor',
          },
        })
      }
    }

    // ถ้า remainingQuota > 0: เปลี่ยนสีชื่อ brand เป็นแดง + เขียนจำนวนที่เหลือลง Column H (remain)
    if (remainingQuota > 0 && codeBrandSheetId !== undefined) {
      const cbRowsRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${CODE_BRAND_TAB}!A:A`,
      })
      const cbRows = cbRowsRes.data.values || []
      let brandRowIdx = -1
      for (let i = 0; i < cbRows.length; i++) {
        const v = (cbRows[i]?.[0] || '').trim()
        if (brandMatch(v, brand)) { brandRowIdx = i; break }
      }
      if (brandRowIdx >= 0) {
        // เขียนจำนวนที่เหลือลง Column H (remain) — ไม่แก้ไขชื่อ brand ใน Column A
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${CODE_BRAND_TAB}!H${brandRowIdx + 1}`,
          valueInputOption: 'RAW',
          requestBody: { values: [[remainingQuota]] },
        })
        // เปลี่ยนสีชื่อ brand ใน Column A เป็นสีแดง
        requests.push({
          repeatCell: {
            range: { sheetId: codeBrandSheetId, startRowIndex: brandRowIdx, endRowIndex: brandRowIdx + 1, startColumnIndex: 0, endColumnIndex: 1 },
            cell: {
              userEnteredFormat: {
                textFormat: { foregroundColor: { red: 0.8, green: 0.0, blue: 0.0 } },
              },
            },
            fields: 'userEnteredFormat.textFormat.foregroundColor',
          },
        })
      }
    }

    if (requests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { requests },
      })
    }

    res.json({ success: true, formattedRows: winnerCells.length })
  } catch (err) {
    console.error('Record winners error:', err)
    res.status(500).json({ error: err.message })
  }
})

// Serve static files in production
app.use(express.static(path.join(__dirname, 'dist')))
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

const PORT = process.env.PORT || 8081
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
