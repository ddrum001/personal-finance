import { useState, useEffect, useRef } from 'react'
import { getCategoryHierarchy, addKeyword, deleteKeyword, applyKeywords, setHideFromReports, setMacroHideFromReports, updateCategoryFlags, renameSubCategory, renameCategory, renameMacro, moveSubCategory, moveCategoryToMacro } from '../api/client'
import AddCategoryModal from './AddCategoryModal'

export default function CategoriesTab() {
  const [hierarchy, setHierarchy] = useState({})
  const [expandedMacros, setExpandedMacros] = useState({})
  const [expandedCats, setExpandedCats] = useState({})
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState(null)
  const [search, setSearch] = useState('')
  const [addModal, setAddModal] = useState(null) // null | { prefillMacro, prefillCategory }

  const load = () => getCategoryHierarchy().then(setHierarchy).catch(console.error)
  useEffect(() => { load() }, [])

  const toggleMacro = (macro) => setExpandedMacros(p => ({ ...p, [macro]: !p[macro] }))
  const toggleCat = (key) => setExpandedCats(p => ({ ...p, [key]: !p[key] }))

  const handleApply = async () => {
    setApplying(true)
    setApplyResult(null)
    try {
      const result = await applyKeywords()
      setApplyResult(result)
    } catch (e) {
      setApplyResult({ error: e.message })
    } finally {
      setApplying(false)
    }
  }

  // Filter hierarchy by search term
  const searchLower = search.toLowerCase()
  const filteredHierarchy = {}
  for (const [macro, cats] of Object.entries(hierarchy)) {
    for (const [cat, subs] of Object.entries(cats)) {
      const matchingSubs = subs.filter(sub =>
        !searchLower ||
        sub.sub_category.toLowerCase().includes(searchLower) ||
        cat.toLowerCase().includes(searchLower) ||
        macro.toLowerCase().includes(searchLower) ||
        sub.keywords.some(k => k.keyword.includes(searchLower))
      )
      if (matchingSubs.length > 0) {
        filteredHierarchy[macro] = filteredHierarchy[macro] || {}
        filteredHierarchy[macro][cat] = matchingSubs
      }
    }
  }

  // Auto-expand all when searching
  const macros = Object.keys(filteredHierarchy)
  const activeMacroExpanded = search ? Object.fromEntries(macros.map(m => [m, true])) : expandedMacros
  const allCatKeys = macros.flatMap(m => Object.keys(filteredHierarchy[m]).map(c => `${m}|${c}`))
  const activeCatExpanded = search ? Object.fromEntries(allCatKeys.map(k => [k, true])) : expandedCats

  const macroCount = macros.length
  const catCount = macros.reduce((n, m) => n + Object.keys(filteredHierarchy[m]).length, 0)
  const subCount = macros.reduce((n, m) =>
    n + Object.values(filteredHierarchy[m]).reduce((s, subs) => s + subs.length, 0), 0)

  return (
    <div>
      {/* Header toolbar */}
      <div className="cat-toolbar">
        <div className="cat-toolbar-left">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search categories or keywords…"
            style={{ padding: '7px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, width: 260 }}
          />
          {search && (
            <span style={{ fontSize: 12, color: '#888' }}>
              {subCount} sub · {catCount} cat · {macroCount} macro
            </span>
          )}
        </div>
        <div className="cat-toolbar-right">
          {applyResult && (
            <span style={{ fontSize: 12, color: applyResult.error ? '#ef4444' : '#10b981', flexBasis: '100%' }}>
              {applyResult.error
                ? `Error: ${applyResult.error}`
                : `✓ Labeled ${applyResult.labeled} (${applyResult.skipped} unmatched)`}
            </span>
          )}
          <button
            onClick={() => setAddModal({})}
            style={{ padding: '8px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
          >
            + Add Sub-Category
          </button>
          <button
            onClick={handleApply}
            disabled={applying}
            style={{ padding: '8px 16px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, cursor: applying ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 13 }}
          >
            {applying ? 'Applying…' : 'Apply Keywords'}
          </button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, fontSize: 12, color: '#666', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Badge color="#dbeafe" text="Discretionary" textColor="#1e40af" /> = discretionary spend (click to toggle)
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Badge color="#dcfce7" text="Recurring" textColor="#166534" /> = recurring expense (click to toggle)
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Badge color="#fee2e2" text="Hidden" textColor="#991b1b" /> = excluded from spending reports
        </span>
      </div>

      {addModal && (
        <AddCategoryModal
          hierarchy={hierarchy}
          prefillMacro={addModal.prefillMacro || ''}
          prefillCategory={addModal.prefillCategory || ''}
          onClose={() => setAddModal(null)}
          onSaved={() => {
            load()
            setAddModal(null)
          }}
        />
      )}

      {/* Hierarchy tree */}
      {Object.entries(filteredHierarchy).map(([macro, cats]) => (
        <MacroSection
          key={macro}
          macro={macro}
          cats={cats}
          expanded={!!activeMacroExpanded[macro]}
          onToggle={() => toggleMacro(macro)}
          expandedCats={activeCatExpanded}
          onToggleCat={toggleCat}
          onKeywordChange={load}
          onAddHere={(prefillMacro, prefillCategory) => setAddModal({ prefillMacro, prefillCategory })}
          onHideChange={load}
          onRename={load}
          onMove={load}
          hierarchy={hierarchy}
        />
      ))}

      {macros.length === 0 && search && (
        <p style={{ color: '#aaa', fontSize: 14, marginTop: 24, textAlign: 'center' }}>
          No categories or keywords match "{search}"
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Macro-category accordion section
// ---------------------------------------------------------------------------

function MacroSection({ macro, cats, expanded, onToggle, expandedCats, onToggleCat, onKeywordChange, onAddHere, onHideChange, onRename, onMove, hierarchy }) {
  const allSubs = Object.values(cats).flat()
  const subCount = allSubs.length
  const catCount = Object.keys(cats).length
  const hiddenCount = allSubs.filter(s => s.hide_from_reports).length
  const allHidden = hiddenCount === subCount
  const someHidden = hiddenCount > 0 && !allHidden

  const handleMacroHide = async (e) => {
    e.stopPropagation()
    await setMacroHideFromReports(macro, !allHidden)
    onHideChange()
  }

  return (
    <div style={{ marginBottom: 10, borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex', alignItems: 'center',
          background: allHidden ? '#fafafa' : '#f3f4f6',
          borderBottom: expanded ? '1px solid #e5e7eb' : 'none',
        }}
      >
        <button
          onClick={onToggle}
          style={{
            flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer',
            fontWeight: 700, fontSize: 15, opacity: allHidden ? 0.5 : 1,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{expanded ? '▾' : '▸'} <InlineEdit value={macro} onSave={newName => renameMacro(macro, newName).then(onRename)} /></span>
          <span style={{ fontSize: 12, fontWeight: 400, color: '#666' }}>
            {catCount} {catCount === 1 ? 'category' : 'categories'} · {subCount} sub-categories
          </span>
        </button>
        <button
          onClick={handleMacroHide}
          title={allHidden ? 'Show in reports' : 'Hide from reports'}
          style={{
            margin: '0 12px', padding: '4px 10px', borderRadius: 20, border: '1px solid',
            fontSize: 12, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap',
            background: allHidden ? '#fee2e2' : someHidden ? '#fef9c3' : '#f0fdf4',
            color: allHidden ? '#991b1b' : someHidden ? '#854d0e' : '#166534',
            borderColor: allHidden ? '#fca5a5' : someHidden ? '#fde047' : '#bbf7d0',
          }}
        >
          {allHidden ? '🚫 Hidden' : someHidden ? '◑ Partial' : '✓ Visible'}
        </button>
      </div>

      {expanded && (
        <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Object.entries(cats).map(([cat, subs]) => {
            const catKey = `${macro}|${cat}`
            return (
              <CategorySection
                key={catKey}
                cat={cat}
                macro={macro}
                subs={subs}
                expanded={!!expandedCats[catKey]}
                onToggle={() => onToggleCat(catKey)}
                onKeywordChange={onKeywordChange}
                onAddHere={() => onAddHere(macro, cat)}
                onHideChange={onHideChange}
                onRename={onRename}
                onMove={onMove}
                hierarchy={hierarchy}
              />
            )
          })}
          <button
            onClick={() => onAddHere(macro, '')}
            style={{ alignSelf: 'flex-start', background: 'none', border: '1px dashed #d1d5db', borderRadius: 6, padding: '5px 12px', fontSize: 12, color: '#6b7280', cursor: 'pointer', marginTop: 2 }}
          >
            + Add category under {macro}
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Category accordion section
// ---------------------------------------------------------------------------

function CategorySection({ cat, macro, subs, expanded, onToggle, onKeywordChange, onAddHere, onHideChange, onRename, onMove, hierarchy }) {
  const [movingCat, setMovingCat] = useState(false)
  const [targetMacro, setTargetMacro] = useState('')
  const [moveError, setMoveError] = useState('')
  const allMacros = Object.keys(hierarchy).filter(m => m !== macro)

  const handleMoveCategory = async () => {
    if (!targetMacro) return
    setMoveError('')
    try {
      await moveCategoryToMacro(cat, macro, targetMacro)
      setMovingCat(false)
      onMove()
    } catch (e) {
      try { setMoveError(JSON.parse(e.message).detail) } catch { setMoveError(e.message) }
    }
  }

  return (
    <div style={{ borderRadius: 8, border: '1px solid #e9ebf0', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button
          onClick={onToggle}
          style={{
            flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '9px 14px', background: 'none', border: 'none', cursor: 'pointer',
            fontWeight: 600, fontSize: 14,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{expanded ? '▾' : '▸'} <InlineEdit value={cat} onSave={newName => renameCategory(cat, newName).then(onRename)} /></span>
          <span style={{ fontSize: 12, fontWeight: 400, color: '#888' }}>
            {subs.length} sub-{subs.length === 1 ? 'category' : 'categories'}
          </span>
        </button>
        <button
          onClick={e => { e.stopPropagation(); setMovingCat(v => !v); setTargetMacro(''); setMoveError('') }}
          title="Move to different macro-category"
          className="edit-pencil"
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#9ca3af', padding: '0 12px' }}
        >⇄</button>
      </div>

      {movingCat && (
        <div style={{ padding: '8px 14px 10px', borderTop: '1px solid #f3f4f6', background: '#fafafa', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#555' }}>Move <strong>{cat}</strong> to:</span>
          <select
            value={targetMacro}
            onChange={e => setTargetMacro(e.target.value)}
            style={{ padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12 }}
          >
            <option value="">— select macro —</option>
            {allMacros.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <button onClick={handleMoveCategory} disabled={!targetMacro} style={smallBtn('#6366f1')}>Move</button>
          <button onClick={() => setMovingCat(false)} style={smallBtn('#9ca3af')}>Cancel</button>
          {moveError && <span style={{ fontSize: 11, color: '#ef4444' }}>{moveError}</span>}
        </div>
      )}

      {expanded && (
        <div style={{ borderTop: '1px solid #f3f4f6' }}>
          {subs.map((sub) => (
            <SubCategoryRow
              key={sub.id}
              sub={sub}
              onKeywordChange={onKeywordChange}
              onHideChange={onHideChange}
              onMove={onMove}
              hierarchy={hierarchy}
            />
          ))}
          <div style={{ padding: '8px 16px 10px 28px' }}>
            <button
              onClick={onAddHere}
              style={{ background: 'none', border: '1px dashed #d1d5db', borderRadius: 20, padding: '3px 12px', fontSize: 12, color: '#6b7280', cursor: 'pointer' }}
            >
              + Add sub-category here
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-category row with keyword management
// ---------------------------------------------------------------------------

function SubCategoryRow({ sub, onKeywordChange, onHideChange, onMove, hierarchy }) {
  const [adding, setAdding] = useState(false)
  const [newKw, setNewKw] = useState('')
  const [error, setError] = useState('')
  const [movingSub, setMovingSub] = useState(false)
  const [targetMacro, setTargetMacro] = useState('')
  const [targetCat, setTargetCat] = useState('')
  const [newCatName, setNewCatName] = useState('')
  const [moveError, setMoveError] = useState('')
  const inputRef = useRef(null)

  const allMacros = Object.keys(hierarchy)
  const catsInMacro = targetMacro ? Object.keys(hierarchy[targetMacro] || {}) : []
  const isNewCat = targetCat === '__new__'

  const handleMoveSubCategory = async () => {
    const finalCat = isNewCat ? newCatName.trim() : targetCat
    if (!targetMacro || !finalCat) return
    setMoveError('')
    try {
      await moveSubCategory(sub.id, finalCat, targetMacro)
      setMovingSub(false)
      onMove()
    } catch (e) {
      try { setMoveError(JSON.parse(e.message).detail) } catch { setMoveError(e.message) }
    }
  }

  const handleAdd = async () => {
    if (!newKw.trim()) return
    setError('')
    try {
      await addKeyword(sub.id, newKw.trim())
      setNewKw('')
      setAdding(false)
      onKeywordChange()
    } catch (e) {
      const msg = e.message
      // Parse JSON error from FastAPI if present
      try { setError(JSON.parse(msg).detail) } catch { setError(msg) }
    }
  }

  const handleDelete = async (kwId) => {
    await deleteKeyword(kwId)
    onKeywordChange()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleAdd()
    if (e.key === 'Escape') { setAdding(false); setNewKw('') }
  }

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  return (
    <div className="sub-cat-row" style={{
      borderBottom: '1px solid #f3f4f6',
    }}>
      <div style={{ padding: '10px 16px 10px 28px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      {/* Sub-category name + badges */}
      <div style={{ minWidth: 220 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <InlineEdit value={sub.sub_category} onSave={newName => renameSubCategory(sub.id, newName).then(onKeywordChange)} style={{ fontSize: 13, fontWeight: 500, opacity: sub.hide_from_reports ? 0.45 : 1 }} />
          <button
            onClick={async () => { await setHideFromReports(sub.id, !sub.hide_from_reports); onHideChange() }}
            title={sub.hide_from_reports ? 'Show in reports' : 'Hide from reports'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, lineHeight: 1,
              color: sub.hide_from_reports ? '#ef4444' : '#d1d5db', padding: 0,
            }}
          >
            {sub.hide_from_reports ? '🚫' : '👁'}
          </button>
          <button
            onClick={() => { setMovingSub(v => !v); setTargetMacro(''); setTargetCat(''); setNewCatName(''); setMoveError('') }}
            title="Move to different category"
            className="edit-pencil"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#9ca3af', padding: 0 }}
          >⇄</button>
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
          <ToggleBadge
            active={sub.is_discretionary}
            label="Discretionary"
            activeColor="#dbeafe" activeText="#1e40af"
            onToggle={() => updateCategoryFlags(sub.id, !sub.is_discretionary, sub.is_recurring).then(onKeywordChange)}
          />
          <ToggleBadge
            active={sub.is_recurring}
            label="Recurring"
            activeColor="#dcfce7" activeText="#166534"
            onToggle={() => updateCategoryFlags(sub.id, sub.is_discretionary, !sub.is_recurring).then(onKeywordChange)}
          />
          {sub.hide_from_reports && <Badge color="#fee2e2" text="Hidden" textColor="#991b1b" />}
        </div>
      </div>

      {/* Keywords */}
      <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {sub.keywords.length === 0 && !adding && (
          <span style={{ fontSize: 12, color: '#bbb', fontStyle: 'italic' }}>no keywords</span>
        )}
        {sub.keywords.map(kw => (
          <span
            key={kw.id}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: '#f3f4f6', border: '1px solid #e5e7eb',
              padding: '2px 8px 2px 10px', borderRadius: 20, fontSize: 12,
            }}
          >
            {kw.keyword}
            <button
              onClick={() => handleDelete(kw.id)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 13, lineHeight: 1, padding: '0 1px' }}
              title="Remove keyword"
            >
              ×
            </button>
          </span>
        ))}

        {adding ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              ref={inputRef}
              value={newKw}
              onChange={e => { setNewKw(e.target.value); setError('') }}
              onKeyDown={handleKeyDown}
              placeholder="e.g. whole foods"
              style={{ padding: '3px 8px', border: `1px solid ${error ? '#ef4444' : '#6366f1'}`, borderRadius: 4, fontSize: 12, width: 150 }}
            />
            <button onClick={handleAdd} style={smallBtn('#6366f1')}>Add</button>
            <button onClick={() => { setAdding(false); setNewKw(''); setError('') }} style={smallBtn('#9ca3af')}>✕</button>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            style={{ background: 'none', border: '1px dashed #d1d5db', borderRadius: 20, padding: '2px 10px', fontSize: 12, color: '#6b7280', cursor: 'pointer' }}
          >
            + keyword
          </button>
        )}
        {error && <span style={{ fontSize: 11, color: '#ef4444' }}>{error}</span>}
      </div>
      </div>

      {movingSub && (
        <div style={{ padding: '8px 16px 10px 28px', background: '#fafafa', borderTop: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#555' }}>Move <strong>{sub.sub_category}</strong> to:</span>
          <select
            value={targetMacro}
            onChange={e => { setTargetMacro(e.target.value); setTargetCat('') }}
            style={{ padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12 }}
          >
            <option value="">— macro —</option>
            {allMacros.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          {targetMacro && (
            <select
              value={targetCat}
              onChange={e => setTargetCat(e.target.value)}
              style={{ padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12 }}
            >
              <option value="">— category —</option>
              {catsInMacro.map(c => <option key={c} value={c}>{c}</option>)}
              <option value="__new__">+ New category name…</option>
            </select>
          )}
          {isNewCat && (
            <input
              value={newCatName}
              onChange={e => setNewCatName(e.target.value)}
              placeholder="Category name"
              style={{ padding: '3px 8px', border: '1px solid #6366f1', borderRadius: 4, fontSize: 12, width: 160 }}
            />
          )}
          <button onClick={handleMoveSubCategory} disabled={!targetMacro || !targetCat || (isNewCat && !newCatName.trim())} style={smallBtn('#6366f1')}>Move</button>
          <button onClick={() => setMovingSub(false)} style={smallBtn('#9ca3af')}>Cancel</button>
          {moveError && <span style={{ fontSize: 11, color: '#ef4444' }}>{moveError}</span>}
        </div>
      )}
    </div>
  )
}

function ToggleBadge({ active, label, activeColor, activeText, onToggle }) {
  return (
    <button
      onClick={onToggle}
      title={active ? `Remove "${label}" label` : `Mark as ${label}`}
      style={{
        padding: '1px 7px', borderRadius: 10, fontSize: 11, fontWeight: 600,
        cursor: 'pointer', border: '1px solid',
        background: active ? activeColor : '#f9fafb',
        color: active ? activeText : '#9ca3af',
        borderColor: active ? activeText + '44' : '#e5e7eb',
      }}
    >
      {label}
    </button>
  )
}

function Badge({ color, text, textColor }) {
  return (
    <span style={{ background: color, color: textColor, padding: '1px 7px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
      {text}
    </span>
  )
}

function smallBtn(bg) {
  return { padding: '3px 8px', background: bg, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }
}

// ---------------------------------------------------------------------------
// Inline name editor — shows pencil icon, clicking opens an input
// ---------------------------------------------------------------------------
function InlineEdit({ value, onSave, style = {} }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  const handleSave = async () => {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === value) { setEditing(false); setDraft(value); return }
    setSaving(true)
    setError('')
    try {
      await onSave(trimmed)
      setEditing(false)
    } catch (e) {
      try { setError(JSON.parse(e.message).detail) } catch { setError(e.message) }
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') { setEditing(false); setDraft(value) }
    e.stopPropagation()
  }

  if (editing) return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={e => e.stopPropagation()}>
      <input
        ref={inputRef}
        value={draft}
        onChange={e => { setDraft(e.target.value); setError('') }}
        onKeyDown={handleKeyDown}
        disabled={saving}
        style={{ padding: '2px 6px', border: `1px solid ${error ? '#ef4444' : '#6366f1'}`, borderRadius: 4, fontSize: 'inherit', fontWeight: 'inherit', width: Math.max(120, draft.length * 8) }}
      />
      <button onClick={handleSave} disabled={saving} style={smallBtn('#6366f1')}>{saving ? '…' : '✓'}</button>
      <button onClick={() => { setEditing(false); setDraft(value) }} style={smallBtn('#9ca3af')}>✕</button>
      {error && <span style={{ fontSize: 11, color: '#ef4444' }}>{error}</span>}
    </span>
  )

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...style }}>
      <span>{value}</span>
      <button
        onClick={e => { e.stopPropagation(); setDraft(value); setEditing(true) }}
        title="Rename"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d1d5db', fontSize: 12, padding: 0, lineHeight: 1 }}
        className="edit-pencil"
      >✏</button>
    </span>
  )
}
