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

  // Heartbeat — mark alive on pong, server pings every 25s
  ws.isAlive = true
  ws.on('pong', () => { ws.isAlive = true })

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

// Ping all clients every 25 s — keeps Fly.io proxy from cutting idle WS connections
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) { ws.terminate(); return }
    ws.isAlive = false
    ws.ping()
  })
}, 25000)
wss.on('close', () => clearInterval(heartbeat))

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
  const authConfig = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    ? { credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) } // Railway / production
    : { keyFile: KEY_PATH }                                                  // local dev
  const auth = new google.auth.GoogleAuth({
    ...authConfig,
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

    // 3. ดึงข้อมูล Code people (Name, Code, Extra review, Size)
    const CODE_PEOPLE_TAB = 'Code people'
    let codePeople = { reviewBucket: [], sizeBuckets: {} }
    try {
      const cpRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${CODE_PEOPLE_TAB}!A:D`,
      })
      const cpRows = cpRes.data.values || []
      const reviewBucket = []
      const sizeBuckets = {}
      for (let i = 1; i < cpRows.length; i++) {
        const name = (cpRows[i]?.[0] || '').trim()
        if (!name) continue
        const extraReview = (cpRows[i]?.[2] || '').trim()
        const size = (cpRows[i]?.[3] || '').trim()
        if (extraReview === 'Yes') reviewBucket.push(name)
        if (size) {
          if (!sizeBuckets[size]) sizeBuckets[size] = []
          sizeBuckets[size].push(name)
        }
      }
      codePeople = { reviewBucket, sizeBuckets }
    } catch (e) {
      console.error(`Code people tab error:`, e.message)
    }

    res.json({ brands, tierParticipants, codePeople })
  } catch (err) {
    console.error('Dragon data error:', err)
    res.status(500).json({ error: err.message })
  }
})

// helper: เขียน/ล้างค่าในคอลัมน์ "Extra review" ของ Code brand tab สำหรับ brand นั้น
async function writeCodeBrandExtraReview(sheets, brand, value) {
  // หา row ของ brand (เริ่มจาก row 2 — skip header)
  const cbRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${CODE_BRAND_TAB}!A:A`,
  })
  const cbRows = cbRes.data.values || []
  let brandRowIdx = -1
  for (let i = 1; i < cbRows.length; i++) {
    const v = (cbRows[i]?.[0] || '').trim()
    if (brandMatch(v, brand)) { brandRowIdx = i; break }
  }
  if (brandRowIdx < 0) return

  // หาคอลัมน์ "Extra review" จาก header row
  const hRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${CODE_BRAND_TAB}!1:1`,
  })
  const headers = hRes.data.values?.[0] || []
  let colIdx = headers.findIndex(h => h.toLowerCase().trim() === 'extra review')
  if (colIdx < 0) colIdx = 8 // fallback column I ถ้าไม่มี header
  const colLetter = String.fromCharCode(65 + colIdx)

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${CODE_BRAND_TAB}!${colLetter}${brandRowIdx + 1}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[value]] },
  })
}

// helper: หา brandCol + winnerCells จาก tier tab
async function findWinnerCells(sheets, tabName, brand, winners) {
  const tabRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!A:Z`,
  })
  const tabData = tabRes.data.values || []
  const headerRow = tabData[0] || []
  let brandCol = -1
  for (let col = 0; col < headerRow.length; col++) {
    const cleanHeader = (headerRow[col] || '').trim().replace(/\s*\(\d+\)\s*$/, '')
    if (brandMatch(cleanHeader, brand)) { brandCol = col; break }
  }
  const winnerSet = new Set(winners)
  const winnerCells = []
  if (brandCol >= 0) {
    for (let row = 1; row < tabData.length; row++) {
      const val = (tabData[row]?.[brandCol] || '').trim()
      if (winnerSet.has(val)) winnerCells.push({ rowIdx: row, colIdx: brandCol })
    }
  }
  return winnerCells
}

// POST /api/dragon/record-winners — บันทึกผู้ชนะ (bold + yellow background)
// reviewWinners (optional): รายชื่อที่มาจาก review bucket — บันทึกลง Code brand tab
app.post('/api/dragon/record-winners', async (req, res) => {
  const { brand, tier, winners, reviewWinners } = req.body
  if (!brand || !tier || !Array.isArray(winners)) {
    return res.status(400).json({ error: 'Missing required fields' })
  }
  try {
    const sheets = await getSheetsClient()
    const meta = await getSheetMeta(sheets)
    const tabName = TIER_TO_SHEET[tier] || tier
    const sheetId = meta[tabName]

    const winnerCells = await findWinnerCells(sheets, tabName, brand, winners)

    const requests = []
    if (sheetId !== undefined) {
      for (const { rowIdx, colIdx } of winnerCells) {
        requests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 1, green: 0.953, blue: 0.204 },
                textFormat: { bold: true },
              },
            },
            fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.bold',
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

    // บันทึก review bucket winners ลง Code brand tab คอลัมน์ "Extra review"
    if (Array.isArray(reviewWinners) && reviewWinners.length > 0) {
      await writeCodeBrandExtraReview(sheets, brand, reviewWinners.join(', '))
    }

    res.json({ success: true, formattedRows: winnerCells.length })
  } catch (err) {
    console.error('Record winners error:', err)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/dragon/undo-winners — ย้อนกลับ yellow background + bold → ปกติ
app.post('/api/dragon/undo-winners', async (req, res) => {
  const { brand, tier, winners } = req.body
  if (!brand || !tier || !Array.isArray(winners)) {
    return res.status(400).json({ error: 'Missing required fields' })
  }
  try {
    const sheets = await getSheetsClient()
    const meta = await getSheetMeta(sheets)
    const tabName = TIER_TO_SHEET[tier] || tier
    const sheetId = meta[tabName]

    const winnerCells = await findWinnerCells(sheets, tabName, brand, winners)

    if (sheetId !== undefined && winnerCells.length > 0) {
      const requests = winnerCells.map(({ rowIdx, colIdx }) => ({
        repeatCell: {
          range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 1, green: 1, blue: 1 },
              textFormat: { bold: false },
            },
          },
          fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.bold',
        },
      }))
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { requests },
      })
    }

    // ล้าง review bucket winners ใน Code brand tab คอลัมน์ "Extra review"
    await writeCodeBrandExtraReview(sheets, brand, '')

    res.json({ success: true, restoredRows: winnerCells.length })
  } catch (err) {
    console.error('Undo winners error:', err)
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
