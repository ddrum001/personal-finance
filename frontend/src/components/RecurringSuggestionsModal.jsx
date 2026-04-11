import { useState, useEffect } from 'react'
import { getRecurringSuggestions, createCashflowEntry } from '../api/client'

const RECURRENCE_OPTIONS = [
  { value: 'weekly',    label: 'Weekly' },
  { value: 'biweekly',  label: 'Every 2 weeks' },
  { value: 'monthly',   label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
]

const inputSm = {
  padding: '5px 8px', border: '1px solid #e5e7eb', borderRadius: 5,
  fontSize: 12, background: '#fff',
}

export default function RecurringSuggestionsModal({ onClose, onImported }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    getRecurringSuggestions(6)
      .then((data) => {
        setItems(data.map((s, i) => ({
          key: i,
          selected: true,
          name: s.name,
          amount: String(Math.abs(s.amount)),
          isIncome: s.amount > 0,
          recurrence: s.recurrence,
          date: s.next_date,
          occurrences: s.occurrences,
        })))
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const update = (key, field, value) =>
    setItems((prev) => prev.map((it) => it.key === key ? { ...it, [field]: value } : it))

  const allSelected = items.length > 0 && items.every((it) => it.selected)
  const toggleAll = () => setItems((prev) => prev.map((it) => ({ ...it, selected: !allSelected })))

  const selectedCount = items.filter((it) => it.selected).length

  const handleImport = async () => {
    const toAdd = items.filter((it) => it.selected)
    if (!toAdd.length) return
    setSaving(true)
    setError(null)
    try {
      await Promise.all(toAdd.map((it) => {
        const amt = parseFloat(it.amount)
        if (isNaN(amt) || amt <= 0) return null
        return createCashflowEntry({
          name: it.name.trim(),
          date: it.date,
          amount: it.isIncome ? amt : -amt,
          notes: null,
          is_recurring: true,
          recurrence: it.recurrence,
          recurrence_end_date: null,
        })
      }).filter(Boolean))
      onImported()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: 780, width: '95vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Import Recurring Entries</h2>
            <div style={{ fontSize: 12, color: '#888', marginTop: 3 }}>
              Detected from BofA checking · last 6 months · edit any row before importing
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888', lineHeight: 1 }}>×</button>
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#888', fontSize: 13 }}>
            Scanning checking account history…
          </div>
        )}

        {!loading && error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 12, fontSize: 13, color: '#991b1b', marginBottom: 12 }}>
            {error}
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#888', fontSize: 13 }}>
            No recurring patterns detected. Try adding entries manually.
          </div>
        )}

        {!loading && items.length > 0 && (
          <>
            {/* Select all + count */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid #f3f4f6' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#555' }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                {allSelected ? 'Deselect all' : 'Select all'}
              </label>
              <span style={{ fontSize: 12, color: '#888' }}>
                {items.length} detected · {selectedCount} selected
              </span>
            </div>

            {/* Column headers */}
            <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 110px 130px 130px 110px 48px', gap: 6, alignItems: 'center', padding: '0 2px 6px', borderBottom: '1px solid #f3f4f6', marginBottom: 4 }}>
              <div />
              {['Name', 'Type', 'Amount', 'Frequency', 'Next date', ''].map((h) => (
                <div key={h} style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</div>
              ))}
            </div>

            {/* Rows */}
            <div style={{ maxHeight: 360, overflowY: 'auto', marginBottom: 16 }}>
              {items.map((it) => (
                <div
                  key={it.key}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '24px 1fr 110px 130px 130px 110px 48px',
                    gap: 6,
                    alignItems: 'center',
                    padding: '6px 2px',
                    borderBottom: '1px solid #f9fafb',
                    opacity: it.selected ? 1 : 0.4,
                  }}
                >
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={it.selected}
                    onChange={(e) => update(it.key, 'selected', e.target.checked)}
                  />

                  {/* Name */}
                  <input
                    value={it.name}
                    onChange={(e) => update(it.key, 'name', e.target.value)}
                    style={{ ...inputSm, width: '100%', boxSizing: 'border-box' }}
                  />

                  {/* Income / Expense toggle */}
                  <div style={{ display: 'flex', borderRadius: 5, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
                    <button
                      onClick={() => update(it.key, 'isIncome', false)}
                      style={{
                        flex: 1, padding: '4px 0', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                        background: !it.isIncome ? '#fef2f2' : '#fff',
                        color: !it.isIncome ? '#dc2626' : '#aaa',
                      }}
                    >
                      Exp
                    </button>
                    <button
                      onClick={() => update(it.key, 'isIncome', true)}
                      style={{
                        flex: 1, padding: '4px 0', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                        background: it.isIncome ? '#f0fdf4' : '#fff',
                        color: it.isIncome ? '#16a34a' : '#aaa',
                      }}
                    >
                      Inc
                    </button>
                  </div>

                  {/* Amount */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <span style={{ fontSize: 12, color: '#888' }}>$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={it.amount}
                      onChange={(e) => update(it.key, 'amount', e.target.value)}
                      style={{ ...inputSm, width: '100%', boxSizing: 'border-box' }}
                    />
                  </div>

                  {/* Recurrence */}
                  <select
                    value={it.recurrence}
                    onChange={(e) => update(it.key, 'recurrence', e.target.value)}
                    style={{ ...inputSm, width: '100%', boxSizing: 'border-box' }}
                  >
                    {RECURRENCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>

                  {/* Next date */}
                  <input
                    type="date"
                    value={it.date}
                    onChange={(e) => update(it.key, 'date', e.target.value)}
                    style={{ ...inputSm, width: '100%', boxSizing: 'border-box' }}
                  />

                  {/* Seen count */}
                  <span style={{ fontSize: 11, color: '#bbb', whiteSpace: 'nowrap' }}>{it.occurrences}×</span>
                </div>
              ))}
            </div>

            {error && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 10, fontSize: 13, color: '#991b1b', marginBottom: 12 }}>
                {error}
              </div>
            )}

            {/* Footer buttons */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={onClose}
                style={{ padding: '8px 20px', background: '#f3f4f6', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={saving || selectedCount === 0}
                style={{
                  padding: '8px 20px', borderRadius: 6, border: 'none', cursor: selectedCount === 0 ? 'not-allowed' : 'pointer',
                  fontWeight: 700, fontSize: 13,
                  background: selectedCount === 0 ? '#a5b4fc' : '#6366f1',
                  color: '#fff',
                }}
              >
                {saving ? 'Importing…' : `Add ${selectedCount} selected`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
