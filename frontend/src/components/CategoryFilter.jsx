import { useState, useEffect, useRef } from 'react'

/**
 * Multi-select category filter. Selected sub-categories render as dismissible
 * chips; a searchable grouped dropdown lets the user add more.
 *
 * Props:
 *   categories – flat array of { macro_category, category, sub_category }
 *   selected   – string[] of selected sub_category values
 *   onChange   – (string[]) => void
 */
export default function CategoryFilter({ categories, selected, onChange }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = query.trim()
    ? categories.filter(c =>
        c.sub_category.toLowerCase().includes(query.toLowerCase()) ||
        c.category.toLowerCase().includes(query.toLowerCase()) ||
        c.macro_category.toLowerCase().includes(query.toLowerCase())
      )
    : categories

  // Group by "Macro › Category"
  const grouped = {}
  for (const c of filtered) {
    const key = `${c.macro_category} › ${c.category}`
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(c)
  }

  const toggle = (sub) => {
    onChange(selected.includes(sub) ? selected.filter(s => s !== sub) : [...selected, sub])
  }

  return (
    <div ref={ref} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', position: 'relative' }}>

      {/* Search input */}
      <div style={{ position: 'relative' }}>
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={selected.length ? 'Add category…' : 'Filter by category…'}
          style={{
            padding: '5px 10px', border: '1px solid #e5e7eb', borderRadius: 6,
            fontSize: 13, width: 190, background: '#fff', outline: 'none',
          }}
        />

        {open && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 300,
            background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,.1)', width: 280, maxHeight: 300, overflowY: 'auto',
          }}>
            {Object.keys(grouped).length === 0 ? (
              <div style={{ padding: '10px 14px', color: '#aaa', fontSize: 13 }}>No matches</div>
            ) : Object.entries(grouped).map(([groupKey, items]) => (
              <div key={groupKey}>
                <div style={{
                  padding: '6px 10px 4px', fontSize: 11, fontWeight: 700,
                  color: '#6b7280', background: '#f8f9fa', letterSpacing: '0.04em',
                  textTransform: 'uppercase', position: 'sticky', top: 0,
                }}>
                  {groupKey}
                </div>
                {items.map(c => {
                  const on = selected.includes(c.sub_category)
                  return (
                    <div
                      key={c.sub_category}
                      onMouseDown={() => toggle(c.sub_category)}
                      style={{
                        padding: '7px 14px', fontSize: 13, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 8,
                        background: on ? '#ede9fe' : undefined,
                        color: on ? '#6366f1' : undefined,
                      }}
                      onMouseEnter={e => { if (!on) e.currentTarget.style.background = '#f3f4f6' }}
                      onMouseLeave={e => { e.currentTarget.style.background = on ? '#ede9fe' : '' }}
                    >
                      <span style={{ fontSize: 12, color: '#6366f1', opacity: on ? 1 : 0, flexShrink: 0 }}>✓</span>
                      {c.sub_category}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Selected chips */}
      {selected.map(s => (
        <span key={s} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          background: '#ede9fe', color: '#6366f1',
          border: '1px solid #c4b5fd', borderRadius: 20,
          padding: '3px 8px 3px 10px', fontSize: 12, fontWeight: 600,
        }}>
          {s}
          <button
            onMouseDown={e => { e.stopPropagation(); onChange(selected.filter(x => x !== s)) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7c3aed', fontSize: 14, lineHeight: 1, padding: 0, display: 'flex', alignItems: 'center' }}
          >×</button>
        </span>
      ))}

      {selected.length > 0 && (
        <button
          onMouseDown={() => onChange([])}
          style={{ padding: '3px 8px', border: 'none', background: 'none', color: '#9ca3af', fontSize: 12, cursor: 'pointer', fontWeight: 500 }}
        >
          Clear all
        </button>
      )}
    </div>
  )
}
