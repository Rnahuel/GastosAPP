const PERSONAL_KEYWORDS = [
  'personal',
  'mio',
  'mía',
  'mi ',
  'barberia',
  'peluqueria',
  'ropa',
  'gimnasio',
  'medicina'
]

const SHARED_HINTS = ['somos', 'entre', 'para']
const PAY_ACTIONS = ['pague', 'pague', 'pagué', 'pagó', 'pago']

function normalizeAmount(rawNumber) {
  if (!rawNumber) return 0
  const cleaned = rawNumber.replace(/[.,\s]/g, '')
  return Number.parseInt(cleaned, 10) || 0
}

function extractAmount(input) {
  const matches = [...input.matchAll(/\d+[\d.,]*/g)]
  if (!matches.length) return 0
  const values = matches.map((match) => normalizeAmount(match[0]))
  return Math.max(...values)
}

function extractDivisor(input) {
  const explicit = input.match(/(?:somos|entre|para)\s+(\d{1,2})/i)
  if (!explicit) return { value: null, token: null }
  return {
    value: Number.parseInt(explicit[1], 10),
    token: explicit[0]
  }
}

function extractConcept(input, amount) {
  if (!amount) return input.trim()
  return input.replace(/[\d][\d.,]*/g, '').replace(/\s+/g, ' ').trim()
}

export function interpretExpense(rawInput, currentUser) {
  const normalized = rawInput.trim().toLowerCase()
  const divisorData = extractDivisor(normalized)
  const textForAmount = divisorData.token ? normalized.replace(divisorData.token, ' ') : normalized
  const montoTotal = extractAmount(textForAmount)
  const divisorExplicito = divisorData.value
  const accion = PAY_ACTIONS.some((word) => normalized.includes(word)) ? 'pago' : 'gasto'
  const concepto = extractConcept(normalized, montoTotal)

  const isPersonal = PERSONAL_KEYWORDS.some((word) => normalized.includes(word))
  const hasSharedHint = SHARED_HINTS.some((word) => normalized.includes(word))

  let destinoAparente = 'indeterminado'
  let divisor = 1
  let requiereConfirmacion = false

  if (isPersonal) {
    destinoAparente = 'privado'
    divisor = 1
  } else if (divisorExplicito || hasSharedHint || accion === 'pago') {
    destinoAparente = 'compartido'
    divisor = divisorExplicito || 2
  } else {
    destinoAparente = 'indeterminado'
    divisor = 1
    requiereConfirmacion = true
  }

  const montoPorPersona = divisor > 0 ? Math.round(montoTotal / divisor) : montoTotal
  const deudaGeneradaPareja = destinoAparente === 'compartido' ? montoPorPersona : 0

  return {
    rawInput,
    accion,
    concepto: concepto || 'sin concepto',
    montoTotal,
    divisor,
    montoPorPersona,
    pagador: currentUser,
    deudaGeneradaPareja,
    destinoAparente,
    requiereConfirmacion
  }
}
