import { useEffect, useState, useMemo } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts'
import { getMonthlyTrend } from '../api/client'

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const out = payload.find(p => p.dataKey === 'total_out')
  const in_ = payload.find(p => p.dataKey === 'total_in')
  const net = payload.find(p => p.dataKey === 'net')
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 14px', fontSize: 13, boxShadow: '0 2px 8px rgba(0,0,0,.1)' }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>
      {out && <div style={{ color: '#f43f5e' }}>Out: ${out.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>}
      {in_ && <div style={{ color: '#10b981' }}>In: ${in_.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>}
      {net && (
        <div style={{
          color: net.value >= 0 ? '#10b981' : '#f43f5e',
          fontWeight: 600,
          marginTop: 4,
          borderTop: '1px solid #f3f4f6',
          paddingTop: 4,
        }}>
          Net: {net.value >= 0 ? '+' : ''}${net.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      )}
    </div>
  )
}

const tickFormatter = (v) => `$${Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`

const fmt = (v) =>
  '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function MonthlyTrend({ startDate, endDate }) {
  const [data, setData] = useState([])

  useEffect(() => {
    getMonthlyTrend({ startDate, endDate, months: 12 }).then((rows) => {
      setData(rows.map((r) => ({
        label: `${MONTH_NAMES[r.month - 1]} ${r.year}`,
        total_out: r.total_out,
        total_in: r.total_in,
        net: r.net,
      })))
    }).catch(console.error)
  }, [startDate, endDate])

  const totals = useMemo(() => {
    const totalOut = data.reduce((s, r) => s + r.total_out, 0)
    const totalIn  = data.reduce((s, r) => s + r.total_in,  0)
    return { totalOut, totalIn, net: totalIn - totalOut }
  }, [data])

  if (!data.length) return <p style={{ color: '#888' }}>No trend data yet.</p>

  return (
    <div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={tickFormatter} tick={{ fontSize: 12 }} />
          <Tooltip content={<CustomTooltip />} />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine y={0} stroke="#e5e7eb" />
          <Bar dataKey="total_out" name="Out" fill="#f43f5e" radius={[3, 3, 0, 0]} maxBarSize={36} />
          <Bar dataKey="total_in" name="In" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={36} />
          <Line dataKey="net" name="Net" stroke="#6366f1" strokeWidth={2} dot={{ r: 3, fill: '#6366f1' }} type="monotone" />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Period summary strip */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-around',
        borderTop: '1px solid #f3f4f6',
        paddingTop: 14,
        marginTop: 4,
      }}>
        {[
          { label: 'Total Out', value: fmt(totals.totalOut), color: '#f43f5e' },
          { label: 'Total In',  value: fmt(totals.totalIn),  color: '#10b981' },
          {
            label: 'Net',
            value: (totals.net >= 0 ? '+' : '-') + fmt(totals.net),
            color: totals.net >= 0 ? '#10b981' : '#f43f5e',
          },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color }}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
