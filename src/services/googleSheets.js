const LATENCY = 500
const USE_REAL_SHEETS = import.meta.env.VITE_USE_REAL_SHEETS === 'true'
let sheetsUnavailable = false

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const makeKey = (room) => `room_finanzas_${room}`

function getStore(room) {
  const key = makeKey(room)
  const existing = localStorage.getItem(key)
  if (existing) return JSON.parse(existing)

  const seed = {
    shared: [],
    private: {
      UsuarioA: { salary: 0, personalExpenses: [] },
      UsuarioB: { salary: 0, personalExpenses: [] }
    }
  }

  localStorage.setItem(key, JSON.stringify(seed))
  return seed
}

function saveStore(room, value) {
  localStorage.setItem(makeKey(room), JSON.stringify(value))
}

async function callSheetsApi(action, payload) {
  const response = await fetch('/api/sheets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload })
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || 'No se pudo completar la sincronización con Google Sheets.')
  }

  return response.json()
}

function shouldUseLocalFallback(error) {
  const message = String(error?.message || '').toLowerCase()
  return (
    message.includes('faltan variables de entorno') ||
    message.includes('failed to fetch') ||
    message.includes('500') ||
    message.includes('google sheets')
  )
}

async function tryRealOrFallback(action, payload, fallback) {
  if (!USE_REAL_SHEETS || sheetsUnavailable) {
    return fallback()
  }

  try {
    const data = await callSheetsApi(action, payload)
    return data.result
  } catch (error) {
    if (shouldUseLocalFallback(error)) {
      sheetsUnavailable = true
      console.warn('Sheets no disponible; usando almacenamiento local temporalmente.')
      return fallback()
    }
    throw error
  }
}

export async function loadRoomData({ room }) {
  return tryRealOrFallback('loadRoomData', { room }, async () => {
    await wait(LATENCY)
    return getStore(room)
  })
}

export async function appendSharedExpense({ room, expense }) {
  return tryRealOrFallback('appendSharedExpense', { room, expense }, async () => {
    await wait(LATENCY)
    const store = getStore(room)
    store.shared.unshift({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...expense
    })
    saveStore(room, store)
    return store.shared[0]
  })
}

export async function appendPrivateExpense({ room, profile, expense }) {
  return tryRealOrFallback('appendPrivateExpense', { room, profile, expense }, async () => {
    await wait(LATENCY)
    const store = getStore(room)
    store.private[profile].personalExpenses.unshift({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...expense
    })
    saveStore(room, store)
    return store.private[profile].personalExpenses[0]
  })
}

export async function updateSalary({ room, profile, salary }) {
  return tryRealOrFallback('updateSalary', { room, profile, salary }, async () => {
    await wait(LATENCY)
    const store = getStore(room)
    store.private[profile].salary = salary
    saveStore(room, store)
    return salary
  })
}
