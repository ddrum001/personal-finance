import { useState, useEffect, useRef } from 'react'

export default function CategorySelect({ value, onChange, categories }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  const selected = categories.find(c => c.sub_category === value)

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = query.length > 0
    ? categories.filter(c =>
        c.sub_category.toLowerCase().includes(query.toLowerCase()) ||
        c.category.toLowerCase().includes(query.toLowerCase()) ||
        c.macro_category.toLowerCase().includes(query.toLowerCase())
      )
    : categories

  // Group by macro_category > category
  const grouped = {}
  for (const c of filtered) {
    const key = `${c.macro_category} \u203a ${c.category}`
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(c)
  }

  const handleSelect = (subCat) => {
    onChange(subCat)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={ref} style={{ position: 'relative', minWidth: 240 }}>
      <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #ddd', borderRadius: 6, background: '#fff', padding: '4px 8px' }}>
        <input
          value={open ? query : (selected ? selected.sub_category : value || '')}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => { setOpen(true); setQuery('') }}
          placeholder="Search categories..."
          style={{ border: 'none', outline: 'none', flex: 1, fontSize: 13, background: 'transparent' }}
        />
        {value && (
          <button onClick={() => { onChange(null); setQuery('') }}
            style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 14, padding: '0 2px' }}>\u2715</button>
        )}
      </div>

      {selected && !open && (
        <div style={{ fontSize: 11, color: '#888', marginTop: 3, paddingLeft: 2 }}>
          {selected.macro_category} \u203a {selected.category}
        </div>
      )}

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
          background: '#fff', border: '1px solid #ddd', borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: 280, overflowY: 'auto', marginTop: 2,
        }}>
          {Object.keys(grouped).length === 0 ? (
            <div style={{ padding: '10px 12px', color: '#aaa', fontSize: 13 }}>No matches</div>
          ) : Object.entries(grouped).map(([groupKey, items]) => (
            <div key={groupKey}>
              <div style={{ padding: '6px 10px 2px', fontSize: 11, fontWeight: 700, color: '#888', background: '#f8f9fa', letterSpacing: '0.02em' }}>
                {groupKey}
              </div>
              {items.map(c => (
                <div
                  key={c.sub_category}
                  onClick={() => handleSelect(c.sub_category)}
                  style={{
                    padding: '7px 14px',
                    fontSize: 13,
                    cursor: 'pointer',
                    background: c.sub_category === value ? '#ede9fe' : undefined,
                    color: c.sub_category === value ? '#6366f1' : undefined,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                  onMouseLeave={e => e.currentTarget.style.background = c.sub_category === value ? '#ede9fe' : ''}
                >
                  {c.sub_category}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
