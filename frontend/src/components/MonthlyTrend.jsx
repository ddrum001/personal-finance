import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { getMonthlyTrend } from '../api/client'

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function MonthlyTrend({ startDate, endDate }) {
  const [data, setData] = useState([])

  useEffect(() => {
    getMonthlyTrend({ startDate, endDate, months: 12 }).then((rows) => {
      setData(rows.map((r) => ({ label: `${MONTH_NAMES[r.month - 1]} ${r.year}`, total: r.total })))
    }).catch(console.error)
  }, [startDate, endDate])

  if (!data.length) return <p style={{ color: '#888' }}>No trend data yet.</p>

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
        <YAxis tickFormatter={(v) => `$${v}`} tick={{ fontSize: 12 }} />
        <Tooltip formatter={(v) => `$${v.toFixed(2)}`} />
        <Bar dataKey="total" fill="#6366f1" radius={[4,4,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
