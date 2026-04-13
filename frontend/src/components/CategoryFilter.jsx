/**
 * Three-level cascading category filter: Macro → Category → Sub-category.
 *
 * value: { macro: string|null, category: string|null, sub: string|null }
 * onChange: (newValue) => void
 * categories: flat array of { macro_category, category, sub_category }
 */
export default function CategoryFilter({ categories, value, onChange }) {
  const macros = [...new Set(categories.map(c => c.macro_category))].sort()

  const catOptions = value.macro
    ? [...new Set(
        categories
          .filter(c => c.macro_category === value.macro)
          .map(c => c.category)
      )].sort()
    : []

  const subOptions = value.category
    ? categories
        .filter(c => c.macro_category === value.macro && c.category === value.category)
        .map(c => c.sub_category)
        .sort()
    : []

  const isActive = value.macro || value.category || value.sub

  const setMacro    = (v) => onChange({ macro: v || null, category: null, sub: null })
  const setCategory = (v) => onChange({ ...value, category: v || null, sub: null })
  const setSub      = (v) => onChange({ ...value, sub: v || null })
  const clear       = () => onChange({ macro: null, category: null, sub: null })

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <select value={value.macro || ''} onChange={e => setMacro(e.target.value)} style={sel}>
        <option value="">All macros</option>
        {macros.map(m => <option key={m} value={m}>{m}</option>)}
      </select>

      <select
        value={value.category || ''}
        onChange={e => setCategory(e.target.value)}
        disabled={!value.macro}
        style={{ ...sel, opacity: value.macro ? 1 : 0.45 }}
      >
        <option value="">All categories</option>
        {catOptions.map(c => <option key={c} value={c}>{c}</option>)}
      </select>

      <select
        value={value.sub || ''}
        onChange={e => setSub(e.target.value)}
        disabled={!value.category}
        style={{ ...sel, opacity: value.category ? 1 : 0.45 }}
      >
        <option value="">All sub-categories</option>
        {subOptions.map(s => <option key={s} value={s}>{s}</option>)}
      </select>

      {isActive && (
        <button
          onClick={clear}
          style={{ padding: '5px 10px', border: 'none', background: 'none', color: '#6366f1', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
        >
          Clear ×
        </button>
      )}
    </div>
  )
}

const sel = {
  padding: '6px 10px',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  fontSize: 13,
  background: '#fff',
  maxWidth: 180,
}
