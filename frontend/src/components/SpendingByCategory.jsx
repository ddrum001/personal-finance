import { useEffect, useState, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts'
import { getCategoryBreakdown } from '../api/client'

const COLORS = ['#6366f1','#f59e0b','#10b981','#ef4444','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f97316','#84cc16','#a78bfa','#34d399','#fbbf24','#60a5fa','#f472b6']

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
      <div>${d.total.toFixed(2)}</div>
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
  useEffect(() => { setDrillPath([]) }, [baseLevel, startDate, endDate])

  const handleBarClick = (entry) => {
    if (!canDrill || !entry) return
    const type = groupBy === 'macro_category' ? 'macro' : 'category'
    setDrillPath(prev => [...prev, { type, value: entry.category }])
  }

  const handleBaseLevel = (level) => {
    setBaseLevel(level)
    setDrillPath([])
  }

  const chartHeight = Math.max(280, data.length * 38 + 60)

  const breadcrumbs = drillPath.length > 0
    ? [{ label: 'All', onClick: () => setDrillPath([]) }, ...drillPath.map((item, i) => ({
        label: item.value,
        onClick: () => setDrillPath(drillPath.slice(0, i + 1)),
      }))]
    : []

  if (!data.length && !loading) {
    return (
      <div>
        <Controls baseLevel={baseLevel} onBaseLevel={handleBaseLevel} />
        <p style={{ color: '#888', marginTop: 16 }}>No spending data for this period.</p>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <Controls baseLevel={baseLevel} onBaseLevel={handleBaseLevel} />
        {canDrill && (
          <span style={{ fontSize: 12, color: '#888' }}>Click a bar to drill down</span>
        )}
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
        <p style={{ color: '#aaa', fontSize: 13 }}>Loading…</p>
      ) : (
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            data={data}
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
              cursor={canDrill ? 'pointer' : 'default'}
              onClick={(d) => handleBarClick(d)}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
              <LabelList
                dataKey="total"
                position="right"
                formatter={(v) => `$${v >= 1000 ? `${(v/1000).toFixed(1)}k` : v.toFixed(0)}`}
                style={{ fontSize: 11, fill: '#555' }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
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
