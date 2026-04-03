import { useState } from 'react'

const RECURRENCE_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
]

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6 }
const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }

export default function CashflowEntryModal({ entry, onClose, onSave }) {
  const isEdit = !!entry

  const [name, setName] = useState(entry?.name ?? '')
  const [date, setDate] = useState(entry?.date ?? '')
  const [amountRaw, setAmountRaw] = useState(
    entry ? String(Math.abs(entry.amount)) : ''
  )
  const [isIncome, setIsIncome] = useState(entry ? entry.amount >= 0 : false)
  const [notes, setNotes] = useState(entry?.notes ?? '')
  const [isRecurring, setIsRecurring] = useState(entry?.is_recurring ?? false)
  const [recurrence, setRecurrence] = useState(entry?.recurrence ?? 'monthly')
  const [recurrenceEndDate, setRecurrenceEndDate] = useState(entry?.recurrence_end_date ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const handleSave = async () => {
    if (!name.trim() || !date || !amountRaw) return
    setSaving(true)
    setError(null)
    try {
      const amount = parseFloat(amountRaw)
      if (isNaN(amount) || amount <= 0) throw new Error('Amount must be a positive number')
      await onSave({
        name: name.trim(),
        date,
        amount: isIncome ? amount : -amount,
        notes: notes.trim() || null,
        is_recurring: isRecurring,
        recurrence: isRecurring ? recurrence : null,
        recurrence_end_date: isRecurring && recurrenceEndDate ? recurrenceEndDate : null,
      })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
            {isEdit ? 'Edit Entry' : 'Add Cashflow Entry'}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Name */}
          <div>
            <label style={labelStyle}>Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ridgeview Mortgage"
              style={inputStyle}
              autoFocus
            />
          </div>

          {/* Date */}
          <div>
            <label style={labelStyle}>Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Amount + income/expense toggle */}
          <div>
            <label style={labelStyle}>Amount</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #e5e7eb', flexShrink: 0 }}>
                <button
                  onClick={() => setIsIncome(false)}
                  style={{
                    padding: '8px 14px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                    background: !isIncome ? '#fef2f2' : '#fff',
                    color: !isIncome ? '#dc2626' : '#888',
                  }}
                >
                  Expense
                </button>
                <button
                  onClick={() => setIsIncome(true)}
                  style={{
                    padding: '8px 14px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                    background: isIncome ? '#f0fdf4' : '#fff',
                    color: isIncome ? '#16a34a' : '#888',
                  }}
                >
                  Income
                </button>
              </div>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amountRaw}
                onChange={(e) => setAmountRaw(e.target.value)}
                placeholder="0.00"
                style={{ ...inputStyle, flex: 1 }}
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label style={labelStyle}>Notes <span style={{ color: '#aaa', fontWeight: 400 }}>(optional)</span></label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional note"
              style={inputStyle}
            />
          </div>

          {/* Recurring toggle */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#555' }}>
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={(e) => setIsRecurring(e.target.checked)}
              />
              Recurring
            </label>
          </div>

          {isRecurring && (
            <>
              <div>
                <label style={labelStyle}>Frequency</label>
                <select
                  value={recurrence}
                  onChange={(e) => setRecurrence(e.target.value)}
                  style={inputStyle}
                >
                  {RECURRENCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>End date <span style={{ color: '#aaa', fontWeight: 400 }}>(optional — leave blank to repeat indefinitely)</span></label>
                <input
                  type="date"
                  value={recurrenceEndDate}
                  onChange={(e) => setRecurrenceEndDate(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </>
          )}

          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 10, fontSize: 13, color: '#991b1b' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={onClose}
              style={{ flex: 1, padding: '9px 0', background: '#f3f4f6', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim() || !date || !amountRaw}
              style={{
                flex: 2, padding: '9px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
                fontWeight: 700, fontSize: 14,
                background: saving || !name.trim() || !date || !amountRaw ? '#a5b4fc' : '#6366f1',
                color: '#fff',
              }}
            >
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add entry'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
