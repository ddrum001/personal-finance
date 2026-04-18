const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const QUARTERS = ['Q1','Q2','Q3','Q4']
const YEARS = [2023, 2024, 2025, 2026]

/**
 * Computes { startDate, endDate } ISO strings from a filter object.
 * Exported so callers can use it to build API requests.
 */
export function getDateRange(filter) {
  const today = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

  if (filter.mode === 'all') return {}
  if (filter.mode === 'last30') {
    const start = new Date(today); start.setDate(today.getDate() - 30)
    return { startDate: fmt(start), endDate: fmt(today) }
  }
  if (filter.mode === 'last90') {
    const start = new Date(today); start.setDate(today.getDate() - 90)
    return { startDate: fmt(start), endDate: fmt(today) }
  }
  if (filter.mode === 'last6months') {
    const start = new Date(today); start.setMonth(today.getMonth() - 6)
    return { startDate: fmt(start), endDate: fmt(today) }
  }
  if (filter.mode === 'lastyear') {
    const start = new Date(today); start.setFullYear(today.getFullYear() - 1)
    return { startDate: fmt(start), endDate: fmt(today) }
  }
  if (filter.mode === 'month') {
    const y = filter.year, m = filter.month
    const lastDay = new Date(y, m, 0).getDate()   // day 0 of next month = last day of this month
    return { startDate: `${y}-${pad(m)}-01`, endDate: `${y}-${pad(m)}-${pad(lastDay)}` }
  }
  if (filter.mode === 'quarter') {
    const startMonth = (filter.quarter - 1) * 3 + 1
    const endMonth = filter.quarter * 3
    const lastDay = new Date(filter.year, endMonth, 0).getDate()
    return {
      startDate: `${filter.year}-${pad(startMonth)}-01`,
      endDate: `${filter.year}-${pad(endMonth)}-${pad(lastDay)}`,
    }
  }
  return {}
}

/**
 * Returns a human-readable label for the current filter, e.g. "March 2026", "Q1 2026", "Last 30 days".
 */
export function getFilterLabel(filter) {
  if (filter.mode === 'all') return 'All dates'
  if (filter.mode === 'last30') return 'Last 30 days'
  if (filter.mode === 'last90') return 'Last 90 days'
  if (filter.mode === 'last6months') return 'Last 6 months'
  if (filter.mode === 'lastyear') return 'Last year'
  if (filter.mode === 'month') return `${new Date(filter.year, filter.month - 1).toLocaleString('default', { month: 'long' })} ${filter.year}`
  if (filter.mode === 'quarter') return `Q${filter.quarter} ${filter.year}`
  return ''
}

export default function DateFilter({ filter, onChange }) {
  const { mode, year, month, quarter } = filter

  const set = (patch) => onChange({ ...filter, ...patch })

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {/* Mode pills */}
      <div style={{ display: 'flex', borderRadius: 8, border: '1px solid #e5e7eb', overflow: 'auto', flexWrap: 'wrap' }}>
        {[
          { value: 'last30',     label: 'Last 30d'  },
          { value: 'last90',     label: 'Last 90d'  },
          { value: 'last6months',label: 'Last 6mo'  },
          { value: 'lastyear',   label: 'Last year' },
          { value: 'month',      label: 'Month'     },
          { value: 'quarter',label: 'Quarter'  },
          { value: 'all',    label: 'All'      },
        ].map(({ value, label }) => (
          <button
            key={value}
            onClick={() => set({ mode: value })}
            style={{
              padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: mode === value ? '#6366f1' : '#fff',
              color: mode === value ? '#fff' : '#555',
              borderRight: '1px solid #e5e7eb',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Contextual selects */}
      {mode === 'month' && (
        <>
          <select value={month} onChange={e => set({ month: Number(e.target.value) })} style={sel}>
            {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => set({ year: Number(e.target.value) })} style={sel}>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </>
      )}

      {mode === 'quarter' && (
        <>
          <select value={quarter} onChange={e => set({ quarter: Number(e.target.value) })} style={sel}>
            {QUARTERS.map((q, i) => <option key={i+1} value={i+1}>{q}</option>)}
          </select>
          <select value={year} onChange={e => set({ year: Number(e.target.value) })} style={sel}>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </>
      )}
    </div>
  )
}

const sel = { padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, background: '#fff' }
