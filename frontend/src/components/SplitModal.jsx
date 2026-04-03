import { useState, useEffect } from 'react'
import { getSplits, saveSplits, deleteSplits, getTemplates, createTemplate, deleteTemplate } from '../api/client'
import CategorySelect from './CategorySelect'

export default function SplitModal({ transaction, onClose, onSaved, categories }) {
  const total = Math.abs(transaction.amount)
  const merchantLower = (transaction.merchant_name || transaction.name || '').toLowerCase()

  const [rows, setRows] = useState([{ amount: '', budget_sub_category: '', note: '' }])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const [templates, setTemplates] = useState([])
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [newTemplateName, setNewTemplateName] = useState('')
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)

  // Load existing splits and matching templates
  useEffect(() => {
    getSplits(transaction.transaction_id).then((existing) => {
      if (existing.length > 0) {
        setRows(existing.map((s) => ({
          amount: String(s.amount),
          budget_sub_category: s.budget_sub_category || s.category || '',
          note: s.note || '',
        })))
      } else {
        setRows([{
          amount: String(total),
          budget_sub_category: transaction.budget_sub_category || transaction.custom_category || transaction.category || '',
          note: '',
        }])
      }
    }).catch(() => {})

    getTemplates().then((all) => {
      setTemplates(all.filter((t) => merchantLower.includes(t.merchant_pattern)))
    }).catch(() => {})
  }, [transaction, total, merchantLower])

  const allocated = rows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0)
  const remaining = Math.round((total - allocated) * 100) / 100

  const updateRow = (i, field, value) => {
    setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r))
  }

  const addRow = () => {
    setRows((prev) => [...prev, { amount: remaining > 0 ? String(remaining) : '', budget_sub_category: '', note: '' }])
  }

  const removeRow = (i) => {
    setRows((prev) => prev.filter((_, idx) => idx !== i))
  }

  // Apply a template: scale percents to the transaction total
  const applyTemplate = (tmpl) => {
    setRows(tmpl.splits.map((s) => ({
      amount: ((s.percent / 100) * total).toFixed(2),
      budget_sub_category: s.budget_sub_category,
      note: s.note || '',
    })))
    setError('')
  }

  const handleDeleteTemplate = async (id, e) => {
    e.stopPropagation()
    await deleteTemplate(id)
    setTemplates((prev) => prev.filter((t) => t.id !== id))
  }

  const handleSaveTemplate = async () => {
    if (!newTemplateName.trim()) return
    const totalPct = rows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0)
    const splits = rows.map((r) => ({
      note: r.note || null,
      budget_sub_category: r.budget_sub_category,
      percent: Math.round(((parseFloat(r.amount) || 0) / totalPct) * 10000) / 100,
    }))
    setSavingTemplate(true)
    try {
      const created = await createTemplate({
        merchant_pattern: merchantLower.includes('amazon') ? 'amazon' : merchantLower.split(' ')[0],
        name: newTemplateName.trim(),
        splits,
      })
      setTemplates((prev) => [...prev, created])
      setNewTemplateName('')
      setShowSaveTemplate(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setSavingTemplate(false)
    }
  }

  const handleSave = async () => {
    setError('')
    const parsed = rows.map((r) => ({
      amount: parseFloat(r.amount),
      budget_sub_category: r.budget_sub_category.trim() || null,
      category: r.budget_sub_category.trim() || '',
      note: r.note.trim() || null,
    }))

    if (parsed.some((r) => isNaN(r.amount) || r.amount <= 0)) {
      setError('All amounts must be positive numbers.')
      return
    }
    if (parsed.some((r) => !r.category)) {
      setError('Each split needs a category.')
      return
    }
    if (Math.abs(remaining) > 0.01) {
      setError(`Splits must add up to $${total.toFixed(2)}. Remaining: $${remaining.toFixed(2)}`)
      return
    }

    setSaving(true)
    try {
      await saveSplits(transaction.transaction_id, parsed)
      onSaved?.()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleRemoveSplits = async () => {
    await deleteSplits(transaction.transaction_id)
    onSaved?.()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontWeight: 700, fontSize: 16 }}>Split Transaction</h3>
            <p style={{ fontSize: 13, color: '#555', marginTop: 2 }}>
              {transaction.merchant_name || transaction.name} &mdash; <strong>${total.toFixed(2)}</strong>
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>×</button>
        </div>

        {/* ── Templates ── */}
        {templates.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: '#888', fontWeight: 600, marginBottom: 6 }}>TEMPLATES</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {templates.map((tmpl) => (
                <div key={tmpl.id} style={{ display: 'flex', alignItems: 'center', background: '#e8eaf6', borderRadius: 20, overflow: 'hidden' }}>
                  <button
                    onClick={() => applyTemplate(tmpl)}
                    style={{ padding: '4px 10px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#4338ca' }}
                  >
                    {tmpl.name}
                  </button>
                  <button
                    onClick={(e) => handleDeleteTemplate(tmpl.id, e)}
                    style={{ padding: '4px 6px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#9ca3af' }}
                    title="Delete template"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 12 }}>
          <thead>
            <tr style={{ background: '#f5f7fa' }}>
              <th style={th}>Amount ($)</th>
              <th style={th}>Category</th>
              <th style={th}>Note</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ ...td, width: 100 }}>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={row.amount}
                    onChange={(e) => updateRow(i, 'amount', e.target.value)}
                    style={inputStyle}
                    placeholder="0.00"
                  />
                </td>
                <td style={td}>
                  <CategorySelect
                    value={row.budget_sub_category || null}
                    onChange={(val) => updateRow(i, 'budget_sub_category', val || '')}
                    categories={categories || []}
                  />
                </td>
                <td style={td}>
                  <input
                    value={row.note}
                    onChange={(e) => updateRow(i, 'note', e.target.value)}
                    style={inputStyle}
                    placeholder="Optional"
                  />
                </td>
                <td style={td}>
                  {rows.length > 1 && (
                    <button onClick={() => removeRow(i)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16 }}>×</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <button onClick={addRow} style={{ fontSize: 13, color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
            + Add row
          </button>
          <span style={{ fontSize: 13, color: remaining === 0 ? '#10b981' : remaining < 0 ? '#ef4444' : '#f59e0b', fontWeight: 600 }}>
            {remaining === 0 ? 'Fully allocated' : remaining > 0 ? `$${remaining.toFixed(2)} remaining` : `Over by $${Math.abs(remaining).toFixed(2)}`}
          </span>
        </div>

        {/* ── Save as template ── */}
        {rows.length > 1 && (
          <div style={{ marginBottom: 12 }}>
            {showSaveTemplate ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="Template name (e.g. Household + Personal)"
                  style={{ ...inputStyle, flex: 1 }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveTemplate()}
                  autoFocus
                />
                <button onClick={handleSaveTemplate} disabled={savingTemplate || !newTemplateName.trim()} style={btnStyle('#6366f1')}>
                  Save
                </button>
                <button onClick={() => { setShowSaveTemplate(false); setNewTemplateName('') }} style={btnStyle('#aaa')}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowSaveTemplate(true)}
                style={{ fontSize: 12, color: '#6b7280', background: 'none', border: '1px dashed #d1d5db', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
              >
                + Save as template
              </button>
            )}
          </div>
        )}

        {error && <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 10 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={handleRemoveSplits} style={btnStyle('#888')}>Remove Splits</button>
          <button onClick={onClose} style={btnStyle('#aaa')}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={btnStyle('#6366f1')}>
            {saving ? 'Saving...' : 'Save Splits'}
          </button>
        </div>
      </div>
    </div>
  )
}

const th = { padding: '8px 10px', textAlign: 'left', fontWeight: 600, fontSize: 13 }
const td = { padding: '6px 8px' }
const inputStyle = { width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13 }
function btnStyle(bg) {
  return { padding: '8px 16px', background: bg, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }
}
