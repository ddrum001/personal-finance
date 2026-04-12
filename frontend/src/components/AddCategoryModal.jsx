import { useState, useRef, useEffect } from 'react'
import { createCategory } from '../api/client'

export default function AddCategoryModal({ hierarchy, prefillMacro, prefillCategory, onClose, onSaved }) {
  // Derive sorted unique macro/category lists from hierarchy
  const macroOptions = Object.keys(hierarchy).sort()
  const categoryOptionsFor = (macro) =>
    macro && hierarchy[macro] ? Object.keys(hierarchy[macro]).sort() : []

  const [macro, setMacro] = useState(prefillMacro || '')
  const [category, setCategory] = useState(prefillCategory || '')
  const [subCategory, setSubCategory] = useState('')
  const [isDiscretionary, setIsDiscretionary] = useState(false)
  const [isRecurring, setIsRecurring] = useState(false)
  const [keywords, setKeywords] = useState([])
  const [kwInput, setKwInput] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const kwRef = useRef(null)

  const catOptions = categoryOptionsFor(macro)

  // When macro changes (and it's not the prefilled one), clear category if it no longer applies
  const handleMacroChange = (val) => {
    setMacro(val)
    if (!categoryOptionsFor(val).includes(category)) setCategory('')
  }

  const addKeyword = () => {
    const kw = kwInput.trim().toLowerCase()
    if (!kw) return
    if (!keywords.includes(kw)) setKeywords(prev => [...prev, kw])
    setKwInput('')
    kwRef.current?.focus()
  }

  const removeKeyword = (kw) => setKeywords(prev => prev.filter(k => k !== kw))

  const handleKwKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addKeyword() }
    if (e.key === 'Escape') setKwInput('')
  }

  const handleSave = async () => {
    setError('')
    if (!macro.trim()) return setError('Macro category is required.')
    if (!category.trim()) return setError('Category is required.')

    setSaving(true)
    try {
      await createCategory({
        sub_category: subCategory.trim() || undefined,
        category: category.trim(),
        macro_category: macro.trim(),
        is_discretionary: isDiscretionary,
        is_recurring: isRecurring,
        keywords,
      })
      onSaved()
      onClose()
    } catch (e) {
      try { setError(JSON.parse(e.message).detail) } catch { setError(e.message) }
    } finally {
      setSaving(false)
    }
  }

  // Close on backdrop click
  const handleBackdrop = (e) => { if (e.target === e.currentTarget) onClose() }

  return (
    <div onClick={handleBackdrop} className="modal-overlay">
      <div className="modal modal-sm">
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>Add Category</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#9ca3af' }}>✕</button>
        </div>

        {/* ── Placement ── */}
        <fieldset style={fieldset}>
          <legend style={legend}>Placement in hierarchy</legend>

          <div style={row}>
            <label style={label}>Macro Category <Required /></label>
            <Combobox
              value={macro}
              onChange={handleMacroChange}
              options={macroOptions}
              placeholder="Select or type a macro category…"
            />
          </div>

          <div style={row}>
            <label style={label}>Category <Required /></label>
            <Combobox
              value={category}
              onChange={setCategory}
              options={catOptions}
              placeholder={macro ? 'Select or type a category…' : 'Select a macro category first'}
              disabled={!macro.trim()}
            />
            {macro.trim() && !catOptions.includes(category) && category.trim() && (
              <p style={hint}>"{category}" is a new category — it will be created under {macro}.</p>
            )}
          </div>

          <div style={row}>
            <label style={label}>Sub-Category Name <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span></label>
            <input
              value={subCategory}
              onChange={e => setSubCategory(e.target.value)}
              placeholder={category.trim() ? `Defaults to "${category.trim()}" if left blank` : 'e.g. Whole Foods Run'}
              style={input}
              autoFocus
            />
          </div>
        </fieldset>

        {/* ── Flags ── */}
        <fieldset style={fieldset}>
          <legend style={legend}>Flags</legend>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <Toggle label="Discretionary" checked={isDiscretionary} onChange={setIsDiscretionary} color="#1e40af" bg="#dbeafe" />
            <Toggle label="Recurring" checked={isRecurring} onChange={setIsRecurring} color="#166534" bg="#dcfce7" />
          </div>
        </fieldset>

        {/* ── Keywords ── */}
        <fieldset style={fieldset}>
          <legend style={legend}>Keywords <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional — used to auto-label transactions)</span></legend>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {keywords.map(kw => (
              <span key={kw} style={kwPill}>
                {kw}
                <button onClick={() => removeKeyword(kw)} style={kwX}>×</button>
              </span>
            ))}
            {keywords.length === 0 && (
              <span style={{ fontSize: 12, color: '#bbb', fontStyle: 'italic' }}>no keywords yet</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              ref={kwRef}
              value={kwInput}
              onChange={e => setKwInput(e.target.value)}
              onKeyDown={handleKwKeyDown}
              placeholder="Type a keyword and press Enter…"
              style={{ ...input, flex: 1, fontSize: 13 }}
            />
            <button onClick={addKeyword} style={addBtn}>Add</button>
          </div>
        </fieldset>

        {error && <p style={{ color: '#ef4444', fontSize: 13, marginTop: 8 }}>{error}</p>}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button onClick={onClose} style={cancelBtn}>Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || !macro.trim() || !category.trim()}
            style={{
              ...saveBtn,
              opacity: (saving || !macro.trim() || !category.trim()) ? 0.5 : 1,
              cursor: (saving || !macro.trim() || !category.trim()) ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Combobox: shows a dropdown of options but also allows free text
// ---------------------------------------------------------------------------
function Combobox({ value, onChange, options, placeholder, disabled }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = options.filter(o => o.toLowerCase().includes(value.toLowerCase()))
  const showNew = value.trim() && !options.some(o => o.toLowerCase() === value.toLowerCase())

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        disabled={disabled}
        style={{ ...input, background: disabled ? '#f9fafb' : '#fff', color: disabled ? '#aaa' : undefined }}
      />
      {open && !disabled && (filtered.length > 0 || showNew) && (
        <div style={dropdown}>
          {filtered.map(o => (
            <div
              key={o}
              onMouseDown={() => { onChange(o); setOpen(false) }}
              style={{ ...dropdownItem, background: o === value ? '#ede9fe' : undefined, color: o === value ? '#6366f1' : undefined }}
            >
              {o}
            </div>
          ))}
          {showNew && (
            <div
              onMouseDown={() => { onChange(value.trim()); setOpen(false) }}
              style={{ ...dropdownItem, color: '#6366f1', fontStyle: 'italic', borderTop: filtered.length ? '1px solid #f3f4f6' : 'none' }}
            >
              + Create "{value.trim()}"
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Required() {
  return <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>
}

function Toggle({ label, checked, onChange, color, bg }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
      <div
        onClick={() => onChange(!checked)}
        style={{
          width: 36, height: 20, borderRadius: 10, background: checked ? '#6366f1' : '#d1d5db',
          position: 'relative', transition: 'background 0.2s', flexShrink: 0,
        }}
      >
        <div style={{
          position: 'absolute', top: 3, left: checked ? 18 : 3,
          width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
        }} />
      </div>
      <span style={{ fontSize: 13 }}>
        {checked
          ? <span style={{ background: bg, color, padding: '1px 8px', borderRadius: 10, fontSize: 12, fontWeight: 600 }}>{label}</span>
          : <span style={{ color: '#6b7280' }}>{label}</span>}
      </span>
    </label>
  )
}

// Styles
const overlay = null  // replaced by className
const modal = null    // replaced by className
const fieldset = { border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }
const legend = { fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '0 4px' }
const row = { marginBottom: 12 }
const label = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#374151' }
const input = { width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, outline: 'none', boxSizing: 'border-box' }
const hint = { fontSize: 11, color: '#6366f1', marginTop: 4, fontStyle: 'italic' }
const dropdown = { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', maxHeight: 200, overflowY: 'auto', marginTop: 2 }
const dropdownItem = { padding: '8px 12px', fontSize: 13, cursor: 'pointer', userSelect: 'none' }
const kwPill = { display: 'inline-flex', alignItems: 'center', gap: 4, background: '#f3f4f6', border: '1px solid #e5e7eb', padding: '2px 8px 2px 10px', borderRadius: 20, fontSize: 12 }
const kwX = { background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 13, lineHeight: 1, padding: '0 1px' }
const addBtn = { padding: '7px 14px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }
const cancelBtn = { padding: '8px 16px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 13 }
const saveBtn = { padding: '8px 20px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700 }
