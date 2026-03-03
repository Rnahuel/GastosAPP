import { google } from 'googleapis'

const SHARED_SHEET = 'Gastos_Compartidos'
const PRIVATE_SHEET_A = 'Privado_UsuarioA'
const PRIVATE_SHEET_B = 'Privado_UsuarioB'
const REQUIRED_SHEETS = [SHARED_SHEET, PRIVATE_SHEET_A, PRIVATE_SHEET_B]

const SHEET_HEADERS = {
  [SHARED_SHEET]: [
    'room',
    'createdAt',
    'rawInput',
    'accion',
    'concepto',
    'montoTotal',
    'divisor',
    'montoPorPersona',
    'pagador',
    'deudaGeneradaPareja',
    'destinoAparente'
  ],
  [PRIVATE_SHEET_A]: ['room', 'createdAt', 'type', 'concepto', 'montoTotal', 'rawInput', 'accion', 'pagador'],
  [PRIVATE_SHEET_B]: ['room', 'createdAt', 'type', 'concepto', 'montoTotal', 'rawInput', 'accion', 'pagador']
}

function rangeOf(sheetName, range) {
  return `'${sheetName.replace(/'/g, "''")}'!${range}`
}

function profileSheet(profile) {
  return profile === 'UsuarioB' ? PRIVATE_SHEET_B : PRIVATE_SHEET_A
}

function parseNumber(value) {
  const parsed = Number.parseInt(String(value || '0').replace(/\D/g, ''), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function toExpenseFromPrivateRow(row) {
  return {
    id: crypto.randomUUID(),
    createdAt: row[1] || new Date().toISOString(),
    rawInput: row[5] || '',
    accion: row[6] || 'gasto',
    concepto: row[3] || 'sin concepto',
    montoTotal: parseNumber(row[4]),
    divisor: 1,
    montoPorPersona: parseNumber(row[4]),
    pagador: row[7] || 'UsuarioActual',
    deudaGeneradaPareja: 0,
    destinoAparente: 'privado',
    requiereConfirmacion: false
  }
}

function toExpenseFromSharedRow(row) {
  return {
    id: crypto.randomUUID(),
    createdAt: row[1] || new Date().toISOString(),
    rawInput: row[2] || '',
    accion: row[3] || 'gasto',
    concepto: row[4] || 'sin concepto',
    montoTotal: parseNumber(row[5]),
    divisor: parseNumber(row[6]) || 2,
    montoPorPersona: parseNumber(row[7]),
    pagador: row[8] || 'UsuarioActual',
    deudaGeneradaPareja: parseNumber(row[9]),
    destinoAparente: 'compartido',
    requiereConfirmacion: false
  }
}

function normalizePrivateKey(rawKey) {
  if (!rawKey) return ''

  let key = String(rawKey).trim()

  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1)
  }

  key = key.replace(/\\r/g, '').replace(/\r/g, '').replace(/\\n/g, '\n').trim()

  return key
}

async function getClient() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL
  const privateKey = normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY)

  if (!spreadsheetId || !clientEmail || !privateKey) {
    throw new Error('Faltan variables de entorno de Google Sheets en Vercel.')
  }

  if (!privateKey.includes('BEGIN PRIVATE KEY')) {
    throw new Error('GOOGLE_PRIVATE_KEY inválida: falta encabezado BEGIN PRIVATE KEY.')
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  })

  await auth.authorize()
  const sheets = google.sheets({ version: 'v4', auth })

  await ensureWorkbookStructure(sheets, spreadsheetId)

  return { sheets, spreadsheetId }
}

async function ensureWorkbookStructure(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.title'
  })

  const existingTitles = new Set((meta.data.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean))
  const missing = REQUIRED_SHEETS.filter((title) => !existingTitles.has(title))

  if (missing.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: missing.map((title) => ({ addSheet: { properties: { title } } }))
      }
    })
  }

  await Promise.all(
    REQUIRED_SHEETS.map(async (title) => {
      const { data } = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: rangeOf(title, '1:1')
      })

      const firstRow = data.values?.[0] || []
      if (!firstRow.length) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: rangeOf(title, '1:1'),
          valueInputOption: 'RAW',
          requestBody: { values: [SHEET_HEADERS[title]] }
        })
      }
    })
  )
}

async function readValues(sheets, spreadsheetId, range) {
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range })
  return data.values || []
}

async function appendValues(sheets, spreadsheetId, range, values) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] }
  })
}

async function loadRoomData(payload) {
  const { room } = payload
  const { sheets, spreadsheetId } = await getClient()

  const [sharedRows, privateRowsA, privateRowsB] = await Promise.all([
    readValues(sheets, spreadsheetId, rangeOf(SHARED_SHEET, 'A2:K')),
    readValues(sheets, spreadsheetId, rangeOf(PRIVATE_SHEET_A, 'A2:H')),
    readValues(sheets, spreadsheetId, rangeOf(PRIVATE_SHEET_B, 'A2:H'))
  ])

  const shared = sharedRows
    .filter((row) => row[0] === room)
    .map(toExpenseFromSharedRow)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

  function privateFromRows(rows, profile) {
    const roomRows = rows.filter((row) => row[0] === room)
    const salaryRows = roomRows.filter((row) => row[2] === 'salary')
    const expenseRows = roomRows.filter((row) => row[2] === 'expense')

    const latestSalary = salaryRows.length ? parseNumber(salaryRows[salaryRows.length - 1][4]) : 0

    return {
      salary: latestSalary,
      personalExpenses: expenseRows
        .map(toExpenseFromPrivateRow)
        .map((row) => ({ ...row, pagador: profile }))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    }
  }

  return {
    shared,
    private: {
      UsuarioA: privateFromRows(privateRowsA, 'UsuarioA'),
      UsuarioB: privateFromRows(privateRowsB, 'UsuarioB')
    }
  }
}

async function appendSharedExpense(payload) {
  const { room, expense } = payload
  const { sheets, spreadsheetId } = await getClient()
  const createdAt = new Date().toISOString()

  await appendValues(sheets, spreadsheetId, rangeOf(SHARED_SHEET, 'A:K'), [
    room,
    createdAt,
    expense.rawInput || '',
    expense.accion || 'gasto',
    expense.concepto || 'sin concepto',
    parseNumber(expense.montoTotal),
    parseNumber(expense.divisor),
    parseNumber(expense.montoPorPersona),
    expense.pagador || 'UsuarioActual',
    parseNumber(expense.deudaGeneradaPareja),
    expense.destinoAparente || 'compartido'
  ])

  return { id: crypto.randomUUID(), createdAt, ...expense }
}

async function appendPrivateExpense(payload) {
  const { room, profile, expense } = payload
  const { sheets, spreadsheetId } = await getClient()
  const sheet = profileSheet(profile)
  const createdAt = new Date().toISOString()

  await appendValues(sheets, spreadsheetId, rangeOf(sheet, 'A:H'), [
    room,
    createdAt,
    'expense',
    expense.concepto || 'sin concepto',
    parseNumber(expense.montoTotal),
    expense.rawInput || '',
    expense.accion || 'gasto',
    profile
  ])

  return { id: crypto.randomUUID(), createdAt, ...expense, pagador: profile }
}

async function updateSalary(payload) {
  const { room, profile, salary } = payload
  const { sheets, spreadsheetId } = await getClient()
  const sheet = profileSheet(profile)
  const createdAt = new Date().toISOString()

  await appendValues(sheets, spreadsheetId, rangeOf(sheet, 'A:H'), [
    room,
    createdAt,
    'salary',
    'salario mensual',
    parseNumber(salary),
    '',
    'salario',
    profile
  ])

  return parseNumber(salary)
}

const handlers = {
  loadRoomData,
  appendSharedExpense,
  appendPrivateExpense,
  updateSalary
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }

  try {
    const { action, payload } = req.body || {}
    if (!action || !handlers[action]) {
      return res.status(400).json({ error: 'Acción inválida para API Sheets.' })
    }

    const result = await handlers[action](payload || {})
    return res.status(200).json({ ok: true, result })
  } catch (error) {
    const message = String(error?.message || 'Error interno en API Sheets.')

    if (message.includes('DECODER routines::unsupported')) {
      return res.status(500).json({
        error:
          'GOOGLE_PRIVATE_KEY inválida en Vercel: pegala en una sola línea con \\n y sin comillas adicionales.'
      })
    }

    return res.status(500).json({ error: message })
  }
}
