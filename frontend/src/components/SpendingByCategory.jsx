import { useEffect, useState, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts'
import { getCategoryBreakdown, getTransactions } from '../api/client'

const COLORS = ['#6366f1','#10b981','#f59e0b','#f43f5e','#06b6d4','#a855f7','#f97316','#84cc16']

const LEVELS = [
  { value: 'macro_category', label: 'Macro' },
  { value: 'category',       label: 'Category' },
  { value: 'sub_category',   label: 'Sub-Category' },
]

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 14px', fontSize: 13, boxShadow: '0 2px 8px rgba(0,0,0,.1)' }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{d.category}</div>
      <div>${d.total.toFixed(2)} <span style={{ color: '#6366f1', fontWeight: 600 }}>({d.pct?.toFixed(1)}%)</span></div>
      <div style={{ color: '#888', marginTop: 2 }}>{d.count} transaction{d.count !== 1 ? 's' : ''}</div>
    </div>
  )
}

export default function SpendingByCategory({ startDate, endDate }) {
  const [baseLevel, setBaseLevel] = useState('macro_category')
  // drillPath: array of { type: 'macro'|'category', value: string }
  const [drillPath, setDrillPath] = useState([])
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [drillTxns, setDrillTxns] = useState([])
  const [drillTxnsLoading, setDrillTxnsLoading] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [showUncategorized, setShowUncategorized] = useState(true)

  // Derive fetch params from drillPath + baseLevel
  const { groupBy, filterMacro, filterCategory, canDrill } = useMemo(() => {
    if (drillPath.length === 0) {
      return {
        groupBy: baseLevel,
        filterMacro: undefined,
        filterCategory: undefined,
        canDrill: baseLevel !== 'sub_category',
      }
    }
    if (drillPath.length === 1 && drillPath[0].type === 'macro') {
      return { groupBy: 'category', filterMacro: drillPath[0].value, filterCategory: undefined, canDrill: true }
    }
    // depth >= 2 or single category drill
    const catItem = drillPath.find(p => p.type === 'category')
    return { groupBy: 'sub_category', filterMacro: undefined, filterCategory: catItem?.value, canDrill: false }
  }, [baseLevel, drillPath])

  useEffect(() => {
    if (!startDate || !endDate) return
    setLoading(true)
    getCategoryBreakdown(startDate, endDate, groupBy, { filterMacro, filterCategory })
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [startDate, endDate, groupBy, filterMacro, filterCategory])

  // Reset drill when base level or date range changes
  useEffect(() => { setDrillPath([]); setSelectedCategory(null) }, [baseLevel, startDate, endDate])

  // Fetch recent transactions for selected category
  useEffect(() => {
    if (!selectedCategory) { setDrillTxns([]); return }
    setDrillTxnsLoading(true)
    const params = { startDate, endDate, limit: 10 }
    if (selectedCategory.groupBy === 'sub_category') {
      params.budgetSubCategory = selectedCategory.label
    } else if (selectedCategory.groupBy === 'category') {
      params.budgetCategory = selectedCategory.label
    } else if (selectedCategory.groupBy === 'macro_category') {
      params.budgetMacroCategory = selectedCategory.label
    }
    getTransactions(params)
      .then(setDrillTxns)
      .catch(console.error)
      .finally(() => setDrillTxnsLoading(false))
  }, [selectedCategory, startDate, endDate])

  const handleBarClick = (entry) => {
    if (!entry) return
    const cat = { label: entry.category, groupBy }
    const toggling = selectedCategory?.label === entry.category && selectedCategory?.groupBy === groupBy
    setSelectedCategory(toggling ? null : cat)
    if (!toggling && canDrill) {
      const type = groupBy === 'macro_category' ? 'macro' : 'category'
      setDrillPath(prev => [...prev, { type, value: entry.category }])
    }
  }

  const handleBaseLevel = (level) => {
    setBaseLevel(level)
    setDrillPath([])
    setSelectedCategory(null)
  }

  const displayData = useMemo(() => {
    const filtered = showUncategorized ? data : data.filter(d => d.category !== 'Uncategorized')
    const grandTotal = filtered.reduce((s, d) => s + d.total, 0)
    return filtered.map(d => ({ ...d, pct: grandTotal > 0 ? (d.total / grandTotal) * 100 : 0 }))
  }, [data, showUncategorized])
  const chartHeight = Math.max(280, displayData.length * 38 + 60)

  const breadcrumbs = drillPath.length > 0
    ? [{ label: 'All', onClick: () => setDrillPath([]) }, ...drillPath.map((item, i) => ({
        label: item.value,
        onClick: () => setDrillPath(drillPath.slice(0, i + 1)),
      }))]
    : []

  if (!data.length && !loading) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Controls baseLevel={baseLevel} onBaseLevel={handleBaseLevel} />
          {drillPath.length > 0 && (
            <button
              onClick={() => { setDrillPath(prev => prev.slice(0, -1)); setSelectedCategory(null) }}
              style={{ padding: '5px 12px', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#555' }}
            >
              ← Back
            </button>
          )}
        </div>
        <p style={{ color: '#888', marginTop: 16 }}>No spending data for this period.</p>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <Controls baseLevel={baseLevel} onBaseLevel={handleBaseLevel} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {drillPath.length > 0 && (
            <button
              onClick={() => { setDrillPath(prev => prev.slice(0, -1)); setSelectedCategory(null) }}
              style={{ padding: '5px 12px', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#555' }}
            >
              ← Back
            </button>
          )}
          {!selectedCategory && <span style={{ fontSize: 12, color: '#888' }}>Click a bar to {canDrill ? 'drill down and see recent transactions' : 'see recent transactions'}</span>}
          {data.some(d => d.category === 'Uncategorized') && (
            <button
              onClick={() => setShowUncategorized(s => !s)}
              style={{
                padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: '1px solid #e5e7eb',
                background: showUncategorized ? '#fef9c3' : '#fff',
                color: showUncategorized ? '#854d0e' : '#9ca3af',
              }}
            >
              {showUncategorized ? 'Hide Uncategorized' : 'Show Uncategorized'}
            </button>
          )}
        </div>
      </div>

      {/* Breadcrumb */}
      {breadcrumbs.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
          {breadcrumbs.map((b, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {i > 0 && <span style={{ color: '#bbb' }}>›</span>}
              <button
                onClick={b.onClick}
                style={{ background: 'none', border: 'none', padding: '2px 6px', cursor: 'pointer', fontSize: 13, color: i === breadcrumbs.length - 1 ? '#111' : '#6366f1', fontWeight: i === breadcrumbs.length - 1 ? 700 : 400, borderRadius: 4 }}
              >
                {b.label}
              </button>
            </span>
          ))}
        </div>
      )}

      {loading ? (
        <p className="loading-text">Loading chart…</p>
      ) : (
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            data={displayData}
            layout="vertical"
            margin={{ top: 4, right: 80, left: 8, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(v) => `$${v >= 1000 ? `${(v/1000).toFixed(1)}k` : v}`}
              tick={{ fontSize: 12 }}
            />
            <YAxis
              type="category"
              dataKey="category"
              width={140}
              tick={{ fontSize: 12 }}
              tickFormatter={(v) => v.length > 20 ? v.slice(0, 18) + '…' : v}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar
              dataKey="total"
              radius={[0, 4, 4, 0]}
              cursor="pointer"
              onClick={(d) => handleBarClick(d)}
            >
              {displayData.map((entry, i) => (
                <Cell key={i} fill={selectedCategory?.label === entry.category ? '#4f46e5' : COLORS[i % COLORS.length]} />
              ))}
              <LabelList
                dataKey="total"
                position="right"
                content={({ x, y, width, height, value, index }) => {
                  const d = displayData[index]
                  if (!d) return null
                  const label = `$${value >= 1000 ? `${(value/1000).toFixed(1)}k` : value.toFixed(0)} · ${d.pct.toFixed(1)}%`
                  return <text x={x + width + 6} y={y + height / 2 + 4} fontSize={11} fill="#555">{label}</text>
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}

      {/* Recent transactions for selected category */}
      {selectedCategory && (
        <div style={{ marginTop: 20, borderTop: '1px solid #e5e7eb', paddingTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>Recent: {selectedCategory?.label}</span>
            <button onClick={() => setSelectedCategory(null)} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
          </div>
          {drillTxnsLoading ? (
            <p className="loading-text">Loading transactions…</p>
          ) : drillTxns.length === 0 ? (
            <p style={{ color: '#aaa', fontSize: 13 }}>No transactions found.</p>
          ) : (
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#888', fontWeight: 600, borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ textAlign: 'left', paddingBottom: 6 }}>Date</th>
                  <th style={{ textAlign: 'left', paddingBottom: 6 }}>Merchant</th>
                  <th style={{ textAlign: 'left', paddingBottom: 6 }}>Account</th>
                  <th style={{ textAlign: 'right', paddingBottom: 6 }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {drillTxns.map(t => (
                  <tr key={t.transaction_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '6px 0', color: '#888', whiteSpace: 'nowrap' }}>{t.date}</td>
                    <td style={{ padding: '6px 8px' }}>{t.merchant_name || t.name}</td>
                    <td style={{ padding: '6px 8px', color: '#9ca3af', fontSize: 12 }}>{t.account_name || t.institution_name || '—'}</td>
                    <td style={{ padding: '6px 0', textAlign: 'right', color: t.amount > 0 ? '#ef4444' : '#10b981', whiteSpace: 'nowrap' }}>
                      {t.amount > 0 ? '-' : '+'}${Math.abs(t.amount).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function Controls({ baseLevel, onBaseLevel }) {
  return (
    <div style={{ display: 'flex', borderRadius: 8, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
      {LEVELS.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => onBaseLevel(value)}
          style={{
            padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            background: baseLevel === value ? '#6366f1' : '#fff',
            color: baseLevel === value ? '#fff' : '#555',
            borderRight: '1px solid #e5e7eb',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
