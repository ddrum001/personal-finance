import { useState, useEffect, useCallback } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import {
  getCashflowProjection,
  getCashflowEntries,
  createCashflowEntry,
  updateCashflowEntry,
  deleteCashflowEntry,
  refreshCashflowBalances,
} from '../api/client'
import CashflowEntryModal from './CashflowEntryModal'
import RecurringSuggestionsModal from './RecurringSuggestionsModal'

const fmt = (n) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

const fmtFull = (n) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const fmtDate = (d) => {
  if (!d) return ''
  const [y, m, day] = String(d).split('-')
  return `${parseInt(m)}/${parseInt(day)}/${y}`
}

const WINDOW_OPTIONS = [
  { days: 14,  label: '2 weeks' },
  { days: 30,  label: '1 month' },
  { days: 90,  label: '3 months' },
  { days: 180, label: '6 months' },
]

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{fmtDate(d.date)}</div>
      <div style={{ color: '#6366f1' }}>Balance: {fmt(d.running_balance)}</div>
      <div style={{ color: d.amount >= 0 ? '#16a34a' : '#dc2626', marginTop: 2 }}>
        {d.name}: {fmtFull(d.amount)}
      </div>
    </div>
  )
}

export default function CashflowTab() {
  const [projection, setProjection] = useState(null)
  const [entries, setEntries] = useState([])
  const [days, setDays] = useState(14)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [modal, setModal] = useState(null) // null | 'add' | entry-object
  const [showImport, setShowImport] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [proj, ents] = await Promise.all([
        getCashflowProjection(days),
        getCashflowEntries(),
      ])
      setProjection(proj)
      setEntries(ents)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { load() }, [load])

  const handleRefreshBalance = async () => {
    setRefreshing(true)
    try {
      await refreshCashflowBalances()
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setRefreshing(false)
    }
  }

  const handleSave = async (body) => {
    if (modal && modal !== 'add') {
      await updateCashflowEntry(modal.id, body)
    } else {
      await createCashflowEntry(body)
    }
    await load()
  }

  const handleDelete = async (id) => {
    setDeletingId(id)
    try {
      await deleteCashflowEntry(id)
      await load()
    } finally {
      setDeletingId(null)
    }
  }

  // Build chart data: one point per projected row
  const chartData = projection?.entries ?? []

  // Find minimum balance for reference line placement
  const minBalance = chartData.length
    ? Math.min(...chartData.map((r) => r.running_balance))
    : 0

  const balanceAccounts = projection?.balance_accounts ?? []
  const checkingAccounts = balanceAccounts.filter((a) => a.subtype === 'checking')
  const hasBalance = checkingAccounts.length > 0

  return (
    <div>
      {modal && (
        <CashflowEntryModal
          entry={modal === 'add' ? null : modal}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
      {showImport && (
        <RecurringSuggestionsModal
          onClose={() => setShowImport(false)}
          onImported={load}
        />
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Cashflow Projection</h2>
          {hasBalance && (
            <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
              Starting balance:{' '}
              <strong style={{ color: '#111' }}>{fmt(projection.starting_balance)}</strong>
              {' · '}
              {checkingAccounts.map((a) => `${a.name}${a.mask ? ` ····${a.mask}` : ''}`).join(', ')}
              {checkingAccounts[0]?.balance_updated_at && (
                <span style={{ color: '#aaa' }}>
                  {' · '}updated {new Date(checkingAccounts[0].balance_updated_at).toLocaleDateString()}
                </span>
              )}
            </div>
          )}
          {!hasBalance && !loading && (
            <div style={{ fontSize: 12, color: '#f59e0b', marginTop: 4 }}>
              No balance on file — click "Refresh Balance" to fetch from Plaid, or add entries manually.
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Window selector */}
          <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
            {WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt.days}
                onClick={() => setDays(opt.days)}
                style={{
                  padding: '6px 12px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  background: days === opt.days ? '#6366f1' : '#fff',
                  color: days === opt.days ? '#fff' : '#555',
                  borderRight: '1px solid #e5e7eb',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleRefreshBalance}
            disabled={refreshing}
            style={{ padding: '7px 14px', background: '#fff', border: '1px solid #6366f1', color: '#6366f1', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
          >
            {refreshing ? 'Refreshing…' : 'Refresh Balance'}
          </button>
          <button
            onClick={() => setShowImport(true)}
            style={{ padding: '7px 14px', background: '#fff', border: '1px solid #10b981', color: '#10b981', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
          >
            Import Recurring
          </button>
          <button
            onClick={() => setModal('add')}
            style={{ padding: '7px 14px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
          >
            + Add Entry
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 12, fontSize: 13, color: '#991b1b', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#888', fontSize: 14 }}>Loading…</div>
      ) : (
        <>
          {/* Chart */}
          {chartData.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d) => {
                      const [, m, day] = String(d).split('-')
                      return `${parseInt(m)}/${parseInt(day)}`
                    }}
                    tick={{ fontSize: 11 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                    tick={{ fontSize: 11 }}
                    width={52}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  {minBalance < 0 && <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 2" />}
                  <Line
                    type="stepAfter"
                    dataKey="running_balance"
                    stroke="#6366f1"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Entries management table */}
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: '#374151' }}>
              Scheduled Entries ({entries.length})
            </h3>
            {entries.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#888', fontSize: 14 }}>
                No entries yet — click "+ Add Entry" to get started.
              </div>
            ) : (
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                {entries.map((e, idx) => (
                  <div key={e.id} style={{
                    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 12px',
                    padding: '10px 12px', fontSize: 13,
                    borderTop: idx > 0 ? '1px solid #f3f4f6' : 'none',
                  }}>
                    <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }}>{e.name}</div>
                      {e.notes && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{e.notes}</div>}
                    </div>
                    <span style={{ color: '#888', whiteSpace: 'nowrap' }}>{fmtDate(e.date)}</span>
                    <span style={{ fontWeight: 600, whiteSpace: 'nowrap', color: e.amount >= 0 ? '#16a34a' : '#dc2626' }}>
                      {e.amount >= 0 ? '+' : ''}{fmtFull(e.amount)}
                    </span>
                    <span>
                      {e.is_recurring && e.recurrence ? (
                        <span style={{ background: '#f3f4f6', borderRadius: 12, padding: '2px 8px', fontSize: 11, whiteSpace: 'nowrap' }}>
                          {e.recurrence}{e.recurrence_end_date ? ` until ${fmtDate(e.recurrence_end_date)}` : ''}
                        </span>
                      ) : (
                        <span style={{ color: '#ccc', fontSize: 11 }}>one-time</span>
                      )}
                    </span>
                    <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                      <button
                        onClick={() => setModal(e)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6366f1', fontSize: 12, fontWeight: 600, padding: '2px 8px' }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(e.id)}
                        disabled={deletingId === e.id}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 12, fontWeight: 600, padding: '2px 8px' }}
                      >
                        {deletingId === e.id ? '…' : 'Delete'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Projection table */}
          {chartData.length > 0 && (
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: '#374151' }}>
                Projected Cashflow
              </h3>
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 400 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>Date</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Running Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Starting balance row */}
                  <tr style={{ borderBottom: '1px solid #f3f4f6', background: '#fafafa' }}>
                    <td style={{ ...tdStyle, fontWeight: 600, color: '#555' }}>
                      {checkingAccounts.map((a) => a.name).join(' + ') || 'Starting Balance'}
                    </td>
                    <td style={tdStyle}>Today</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>—</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>
                      {fmt(projection.starting_balance)}
                    </td>
                  </tr>
                  {chartData.map((row, i) => (
                    <tr
                      key={`${row.id}-${i}`}
                      style={{
                        borderBottom: '1px solid #f3f4f6',
                        background: row.running_balance < 0 ? '#fef2f2' : undefined,
                      }}
                    >
                      <td style={tdStyle}>
                        {row.name}
                        {row.is_recurring && (
                          <span style={{ marginLeft: 6, fontSize: 10, color: '#a78bfa', background: '#ede9fe', borderRadius: 10, padding: '1px 6px' }}>
                            {row.recurrence}
                          </span>
                        )}
                      </td>
                      <td style={tdStyle}>{fmtDate(row.date)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: row.amount >= 0 ? '#16a34a' : '#dc2626' }}>
                        {row.amount >= 0 ? '+' : ''}{fmtFull(row.amount)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: row.running_balance < 0 ? '#dc2626' : '#111' }}>
                        {fmt(row.running_balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

const thStyle = { textAlign: 'left', padding: '8px 10px', fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }
const tdStyle = { padding: '9px 10px', verticalAlign: 'middle' }
