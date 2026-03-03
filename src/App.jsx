import { useMemo, useState } from 'react'
import { interpretExpense } from './parser/expenseInterpreter'
import {
  appendPrivateExpense,
  appendSharedExpense,
  loadRoomData,
  updateSalary
} from './services/googleSheets'

const PROFILE_LABELS = {
  UsuarioA: 'Usuario A',
  UsuarioB: 'Usuario B'
}

function money(value) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(value || 0)
}

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(false)
  const [consoleInput, setConsoleInput] = useState('')
  const [pendingInterpretation, setPendingInterpretation] = useState(null)
  const [syncMessage, setSyncMessage] = useState('')
  const [sharedHistory, setSharedHistory] = useState([])
  const [privateState, setPrivateState] = useState({ salary: 0, personalExpenses: [] })
  const [balance, setBalance] = useState(0)
  const [salaryDraft, setSalaryDraft] = useState('0')

  const profile = session?.profile

  async function handleLogin(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const room = String(form.get('room') || '').trim()
    const pin = String(form.get('pin') || '').trim()
    const nextProfile = String(form.get('profile') || 'UsuarioA')

    if (!room || !/^\d{4}$/.test(pin)) {
      setSyncMessage('Ingresá una sala y un PIN numérico de 4 dígitos.')
      return
    }

    setLoading(true)
    try {
      const data = await loadRoomData({ room })
      setSession({ room, pin, profile: nextProfile })
      setSharedHistory(data.shared)
      setPrivateState(data.private[nextProfile])
      setSalaryDraft(String(data.private[nextProfile].salary || 0))
      setSyncMessage('Sesión iniciada.')
    } finally {
      setLoading(false)
    }
  }

  const personalSpent = useMemo(
    () => privateState.personalExpenses.reduce((acc, row) => acc + (row.montoTotal || 0), 0),
    [privateState.personalExpenses]
  )

  const remaining = (privateState.salary || 0) - personalSpent

  function computeBalanceLabel() {
    if (balance === 0) return 'Están al día.'
    if (balance > 0) return `${PROFILE_LABELS.UsuarioB} te debe ${money(balance)}`
    return `Le debés a ${PROFILE_LABELS.UsuarioB}: ${money(Math.abs(balance))}`
  }

  async function persistExpense(expense, destination) {
    if (!session || !profile) return

    const optimisticId = `tmp-${Date.now()}`

    if (destination === 'compartido') {
      const optimisticRow = { ...expense, id: optimisticId, createdAt: new Date().toISOString() }
      setSharedHistory((prev) => [optimisticRow, ...prev])

      const delta = profile === 'UsuarioA' ? expense.deudaGeneradaPareja : -expense.deudaGeneradaPareja
      setBalance((prev) => prev + delta)

      try {
        await appendSharedExpense({ room: session.room, expense })
        setSyncMessage('Gasto compartido sincronizado.')
      } catch {
        setSharedHistory((prev) => prev.filter((row) => row.id !== optimisticId))
        setBalance((prev) => prev - delta)
        setSyncMessage('Error de sincronización en gasto compartido.')
      }
      return
    }

    const optimisticRow = { ...expense, id: optimisticId, createdAt: new Date().toISOString() }
    setPrivateState((prev) => ({ ...prev, personalExpenses: [optimisticRow, ...prev.personalExpenses] }))

    try {
      await appendPrivateExpense({ room: session.room, profile, expense })
      setSyncMessage('Gasto personal sincronizado.')
    } catch {
      setPrivateState((prev) => ({
        ...prev,
        personalExpenses: prev.personalExpenses.filter((row) => row.id !== optimisticId)
      }))
      setSyncMessage('Error de sincronización en gasto personal.')
    }
  }

  async function submitConsole(event) {
    event.preventDefault()
    if (!consoleInput.trim() || !profile) return

    const interpreted = interpretExpense(consoleInput, profile)

    if (interpreted.requiereConfirmacion) {
      setPendingInterpretation(interpreted)
      setSyncMessage('Destino ambiguo: seleccioná dónde guardar este gasto.')
      return
    }

    await persistExpense(interpreted, interpreted.destinoAparente)
    setConsoleInput('')
  }

  async function resolvePending(destination) {
    if (!pendingInterpretation) return
    let expense = { ...pendingInterpretation, destinoAparente: destination, requiereConfirmacion: false }

    if (destination === 'compartido') {
      const divisor = 2
      const montoPorPersona = Math.round((expense.montoTotal || 0) / divisor)
      expense = {
        ...expense,
        divisor,
        montoPorPersona,
        deudaGeneradaPareja: montoPorPersona
      }
    }

    await persistExpense(expense, destination)
    setPendingInterpretation(null)
    setConsoleInput('')
  }

  async function submitSalary(event) {
    event.preventDefault()
    if (!session || !profile) return
    const value = Number.parseInt(salaryDraft.replace(/\D/g, ''), 10) || 0

    const previous = privateState.salary
    setPrivateState((prev) => ({ ...prev, salary: value }))

    try {
      await updateSalary({ room: session.room, profile, salary: value })
      setSyncMessage('Salario actualizado.')
    } catch {
      setPrivateState((prev) => ({ ...prev, salary: previous }))
      setSyncMessage('No se pudo actualizar salario.')
    }
  }

  if (!session) {
    return (
      <main className="screen login-screen">
        <section className="card">
          <h1>Room</h1>
          <p>Gestor financiero para pareja</p>
          <form onSubmit={handleLogin} className="stack">
            <label>
              Sala
              <input name="room" placeholder="ej: room-casa" required />
            </label>
            <label>
              PIN (4 dígitos)
              <input name="pin" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" required />
            </label>
            <label>
              Perfil
              <select name="profile" defaultValue="UsuarioA">
                <option value="UsuarioA">Usuario A</option>
                <option value="UsuarioB">Usuario B</option>
              </select>
            </label>
            <button type="submit" disabled={loading}>
              {loading ? 'Ingresando...' : 'Entrar'}
            </button>
          </form>
          <small>{syncMessage}</small>
        </section>
      </main>
    )
  }

  return (
    <main className="screen dashboard">
      <header className="card">
        <h2>Room · {PROFILE_LABELS[profile]}</h2>
        <small>Sala: {session.room}</small>
      </header>

      <section className="card">
        <h3>Mi Salario (Privado)</h3>
        <form onSubmit={submitSalary} className="salary-form">
          <input value={salaryDraft} onChange={(e) => setSalaryDraft(e.target.value)} inputMode="numeric" />
          <button type="submit">Guardar</button>
        </form>
        <p>Ingreso mensual: {money(privateState.salary)}</p>
        <p>Gastos personales: {money(personalSpent)}</p>
        <p>Saldo real restante: {money(remaining)}</p>
      </section>

      <section className="card">
        <h3>Balance Compartido</h3>
        <p>{computeBalanceLabel()}</p>
      </section>

      <section className="card history">
        <h3>Historial Compartido</h3>
        <ul>
          {sharedHistory.slice(0, 20).map((row) => (
            <li key={row.id}>
              <strong>{row.concepto}</strong>
              <span>
                {row.pagador} · total {money(row.montoTotal)} · división {row.divisor} · por persona{' '}
                {money(row.montoPorPersona)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {pendingInterpretation && (
        <section className="confirm-strip">
          <p>Destino no claro para “{pendingInterpretation.rawInput}”</p>
          <div>
            <button onClick={() => resolvePending('compartido')}>Compartido</button>
            <button onClick={() => resolvePending('privado')}>Privado</button>
          </div>
        </section>
      )}

      <form className="console" onSubmit={submitConsole}>
        <input
          value={consoleInput}
          onChange={(e) => setConsoleInput(e.target.value)}
          placeholder="Ej: pague hamburguesas 50000 somos 5"
        />
        <button type="submit">Enviar</button>
      </form>
      <footer className="sync-message">{syncMessage}</footer>
    </main>
  )
}
