import { useState, useMemo } from 'react'
import { updateBudgetCategory, markReviewed, markReviewedBulk, flagForReview, acceptSuggestions, rejectSuggestion, unlinkAmazonOrder, addKeyword, applyKeywords, undoKeyword, updateTransactionNotes } from '../api/client'
import SplitModal from './SplitModal'
import CategorySelect from './CategorySelect'

export default function TransactionList({ transactions, onUpdated, categories, reviewMode, hasMore, onLoadMore }) {
  const [editing, setEditing] = useState(null)
  const [newBudgetSubCategory, setNewBudgetSubCategory] = useState(null)
  const [splitting, setSplitting] = useState(null)
  const [expandedAmazon, setExpandedAmazon] = useState(new Set())
  const toggleAmazon = (id) => setExpandedAmazon(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const handleAmazonUnlink = async (txnId, orderId) => {
    await unlinkAmazonOrder(orderId)
    setExpandedAmazon(prev => { const n = new Set(prev); n.delete(txnId); return n })
    onUpdated?.()
  }
  const [selectedAccounts, setSelectedAccounts] = useState(new Set())
  const [amazonFilter, setAmazonFilter] = useState(null) // null | 'linked' | 'unlinked'
  const [markingAll, setMarkingAll] = useState(false)
  // Map of id → transaction snapshot for transactions reviewed this session
  // Keeps them visible in review mode so the undo button can be clicked
  const [reviewedThisSession, setReviewedThisSession] = useState(new Map())
  // Local field overrides applied on top of the prop — avoids re-fetch for Accept/Defer
  const [txnOverrides, setTxnOverrides] = useState({})

  // Inline keyword-add state (keyed by transaction_id)
  const [kwOpen, setKwOpen] = useState({})
  const [kwInput, setKwInput] = useState({})
  const [kwCategory, setKwCategory] = useState({})
  const [kwStatus, setKwStatus] = useState({})     // null | 'loading' | 'success' | 'no-match' | 'conflict' | 'error' | 'undoing'
  const [kwCount, setKwCount] = useState({})       // labeled count from last apply run
  const [kwKeywordId, setKwKeywordId] = useState({}) // saved keyword id for undo

  // Inline note editing (keyed by transaction_id)
  const [noteOpen, setNoteOpen] = useState({})
  const [noteInput, setNoteInput] = useState({})
  const [noteSaving, setNoteSaving] = useState({})

  const toggleKwOpen = (txn) => {
    const id = txn.transaction_id
    setKwOpen(prev => ({ ...prev, [id]: !prev[id] }))
    // Pre-fill with first word of merchant/name on first open; don't overwrite if already edited
    setKwInput(prev => prev[id] !== undefined ? prev : {
      ...prev,
      [id]: (txn.original_description || txn.merchant_name || txn.name || '').toLowerCase().split(' ')[0],
    })
    setKwStatus(prev => ({ ...prev, [id]: null }))
  }

  const handleAddAndTest = async (txn) => {
    const keyword = (kwInput[txn.transaction_id] || '').trim().toLowerCase()
    const subCat = kwCategory[txn.transaction_id]
    if (!keyword || !subCat) return
    const cat = (categories || []).find(c => c.sub_category === subCat)
    if (!cat) return

    setKwStatus(prev => ({ ...prev, [txn.transaction_id]: 'loading' }))

    let savedKeywordId = null
    try {
      const kw = await addKeyword(cat.id, keyword)
      savedKeywordId = kw.id
      setKwKeywordId(prev => ({ ...prev, [txn.transaction_id]: kw.id }))
    } catch (err) {
      const msg = err.message || ''
      const isConflict = msg.includes('already') || msg.includes('409')
      setKwStatus(prev => ({ ...prev, [txn.transaction_id]: isConflict ? 'conflict' : 'error' }))
      return
    }

    try {
      const result = await applyKeywords()  // global — applies to all unlabeled transactions
      const searchText = `${txn.name || ''} ${txn.merchant_name || ''} ${txn.original_description || ''}`.toLowerCase()
      const thisMatched = searchText.includes(keyword)
      setKwCount(prev => ({ ...prev, [txn.transaction_id]: result.labeled }))
      if (thisMatched) {
        setKwStatus(prev => ({ ...prev, [txn.transaction_id]: 'success' }))
      } else {
        setKwStatus(prev => ({ ...prev, [txn.transaction_id]: 'no-match' }))
      }
      if (result.labeled > 0) setTimeout(() => onUpdated?.(), 900)
    } catch {
      setKwStatus(prev => ({ ...prev, [txn.transaction_id]: 'error' }))
    }
  }

  const handleUndoKeyword = async (txnId) => {
    const keywordId = kwKeywordId[txnId]
    if (!keywordId) return
    setKwStatus(prev => ({ ...prev, [txnId]: 'undoing' }))
    try {
      await undoKeyword(keywordId)
      setKwOpen(prev => ({ ...prev, [txnId]: false }))
      setKwStatus(prev => ({ ...prev, [txnId]: null }))
      setKwKeywordId(prev => { const n = { ...prev }; delete n[txnId]; return n })
      onUpdated?.()
    } catch {
      setKwStatus(prev => ({ ...prev, [txnId]: 'error' }))
    }
  }

  const handleSaveNote = async (txnId) => {
    const note = (noteInput[txnId] ?? '').trim()
    setNoteSaving(prev => ({ ...prev, [txnId]: true }))
    try {
      await updateTransactionNotes(txnId, note || null)
      applyOverride(txnId, { notes: note || null })
      setNoteOpen(prev => ({ ...prev, [txnId]: false }))
    } finally {
      setNoteSaving(prev => ({ ...prev, [txnId]: false }))
    }
  }

  const applyOverride = (id, fields) =>
    setTxnOverrides(prev => ({ ...prev, [id]: { ...(prev[id] || {}), ...fields } }))
  const clearOverride = (id) =>
    setTxnOverrides(prev => { const n = { ...prev }; delete n[id]; return n })

  const handleSave = async (id) => {
    if (newBudgetSubCategory) await updateBudgetCategory(id, newBudgetSubCategory)
    setEditing(null)
    setNewBudgetSubCategory(null)
    onUpdated?.()
  }

  const handleMarkReviewed = (txn) => {
    // Optimistic: immediately mark reviewed in local state — no re-fetch
    applyOverride(txn.transaction_id, { needs_review: false, _justReviewed: true })
    setReviewedThisSession(prev => new Map(prev).set(txn.transaction_id, txn))
    markReviewed(txn.transaction_id)
  }

  const handleRejectSuggestion = (txn) => {
    // Optimistic: clear suggestion, move to Group B — no re-fetch
    applyOverride(txn.transaction_id, { budget_sub_category: null, budget_category: null, budget_macro_category: null })
    rejectSuggestion(txn.transaction_id)
  }

  const handleUndoReviewed = async (id) => {
    await flagForReview(id)
    clearOverride(id)
    setReviewedThisSession(prev => { const m = new Map(prev); m.delete(id); return m })
    onUpdated?.()
  }

  const handleMarkAllReviewed = async () => {
    setMarkingAll(true)
    const ids = visible.filter(t => t.needs_review).map(t => t.transaction_id)
    if (ids.length) await markReviewedBulk(ids)
    setMarkingAll(false)
    onUpdated?.()
  }

  const handleAcceptAllSuggestions = async () => {
    setMarkingAll(true)
    await acceptSuggestions()
    setMarkingAll(false)
    onUpdated?.()
  }

  const startEdit = (t) => { setEditing(t.transaction_id); setNewBudgetSubCategory(t.budget_sub_category || null) }
  const cancelEdit = () => { setEditing(null); setNewBudgetSubCategory(null) }

  // Flat account list derived from transaction data
  const allAccounts = useMemo(() => {
    const seen = new Set()
    const result = []
    transactions.forEach((t) => {
      if (!t.account_id || seen.has(t.account_id)) return
      seen.add(t.account_id)
      const inst = t.institution_name?.split(' ')[0] ?? ''
      const label = inst + (t.account_mask ? ` ····${t.account_mask}` : (t.account_name ? ` ${t.account_name.split(' ')[0]}` : ''))
      result.push({ account_id: t.account_id, label })
    })
    return result
  }, [transactions])

  const toggleAccount = (id) => setSelectedAccounts(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const currentIds = useMemo(() => new Set(transactions.map((t) => t.transaction_id)), [transactions])

  // Merge local overrides on top of server data
  const withOverrides = useMemo(() =>
    transactions.map(t => txnOverrides[t.transaction_id] ? { ...t, ...txnOverrides[t.transaction_id] } : t),
    [transactions, txnOverrides]
  )

  // In review mode, keep recently-reviewed rows visible (with undo button) even after parent re-fetch removes them
  const recentlyReviewedRows = useMemo(() => {
    if (!reviewMode) return []
    return [...reviewedThisSession.entries()]
      .filter(([id]) => !currentIds.has(id))
      .map(([, txn]) => ({ ...txn, needs_review: false, _justReviewed: true }))
  }, [reviewMode, reviewedThisSession, currentIds])

  const visible = [
    ...withOverrides.filter((t) => {
      if (selectedAccounts.size > 0 && !selectedAccounts.has(t.account_id)) return false
      if (amazonFilter === 'linked' && !t.amazon_order) return false
      if (amazonFilter === 'unlinked' && t.amazon_order) return false
      return true
    }),
    ...recentlyReviewedRows,
  ]

  return (
    <>
      {splitting && (
        <SplitModal
          transaction={splitting}
          onClose={() => setSplitting(null)}
          onSaved={onUpdated}
          categories={categories}
        />
      )}

      {/* ── Account filter bar ── */}
      {allAccounts.length > 1 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', overflowX: 'auto', gap: 6, alignItems: 'center', marginBottom: 8, scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', paddingBottom: 2 }}>
            <button
              onClick={() => setSelectedAccounts(new Set())}
              style={{
                flexShrink: 0, padding: '3px 10px', border: '1px solid #e5e7eb', borderRadius: 20, fontSize: 12,
                cursor: 'pointer', fontWeight: selectedAccounts.size === 0 ? 600 : 400,
                background: selectedAccounts.size === 0 ? '#6366f1' : '#f9fafb',
                color: selectedAccounts.size === 0 ? '#fff' : '#555',
                borderColor: selectedAccounts.size === 0 ? '#6366f1' : '#e5e7eb',
              }}
            >All</button>
            {allAccounts.map((a) => {
              const active = selectedAccounts.has(a.account_id)
              return (
                <button
                  key={a.account_id}
                  onClick={() => toggleAccount(a.account_id)}
                  style={{
                    flexShrink: 0, padding: '3px 10px', border: '1px solid #e5e7eb', borderRadius: 20, fontSize: 12,
                    cursor: 'pointer', fontWeight: active ? 600 : 400,
                    background: active ? '#6366f1' : '#f9fafb',
                    color: active ? '#fff' : '#555',
                    borderColor: active ? '#6366f1' : '#e5e7eb',
                  }}
                >{a.label}</button>
              )
            })}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#888', marginRight: 4 }}>Amazon:</span>
            {[
              { value: null, label: 'All' },
              { value: 'linked', label: '📦 Linked' },
              { value: 'unlinked', label: 'Not linked' },
            ].map(({ value, label }) => (
              <button
                key={String(value)}
                onClick={() => setAmazonFilter(value)}
                style={{
                  padding: '3px 10px', border: '1px solid #e5e7eb', borderRadius: 20, fontSize: 12,
                  cursor: 'pointer',
                  background: amazonFilter === value ? '#f97316' : '#f9fafb',
                  color: amazonFilter === value ? '#fff' : '#555',
                  borderColor: amazonFilter === value ? '#f97316' : '#e5e7eb',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

{/* Review mode banner */}
      {reviewMode && (() => {
        const suggested = visible.filter(t => t.needs_review && t.budget_sub_category)
        const uncategorized = visible.filter(t => t.needs_review && !t.budget_sub_category)
        return (
          <div style={{ background: '#fef9c3', border: '1px solid #fde047', borderRadius: 8, padding: '10px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#854d0e', fontWeight: 600 }}>
              ⚠ {visible.filter(t => t.needs_review).length} need review
              {suggested.length > 0 && <span style={{ fontWeight: 400, marginLeft: 8 }}>· {suggested.length} suggested · {uncategorized.length} uncategorized</span>}
            </span>
            {suggested.length > 0 && (
              <button
                onClick={handleAcceptAllSuggestions}
                disabled={markingAll}
                className="btn btn-success btn-sm"
              >
                {markingAll ? 'Accepting…' : `Accept all ${suggested.length} remaining suggestions`}
              </button>
            )}
          </div>
        )
      })()}

      <div style={{ fontSize: 13, color: '#888', marginBottom: 12 }}>
        {visible.length} transaction{visible.length !== 1 ? 's' : ''}
        {(selectedAccounts.size > 0 || amazonFilter) ? ' (filtered)' : ''}
      </div>

      {/* ── Group A: Suggested (review mode only) ── */}
      {reviewMode && (() => {
        const suggested = visible.filter(t => t.needs_review && t.budget_sub_category)
        if (suggested.length === 0) return null
        return (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              Suggested ({suggested.length})
            </div>
            <div style={{ border: '1px solid #bbf7d0', borderRadius: 8 }}>
              {suggested.map((t, idx) => (
                <div key={t.transaction_id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
                  borderTop: idx > 0 ? '1px solid #dcfce7' : undefined,
                  background: editing === t.transaction_id ? '#f0fdf4' : '#fff',
                  flexWrap: 'wrap',
                  borderTopLeftRadius: idx === 0 ? 7 : undefined,
                  borderTopRightRadius: idx === 0 ? 7 : undefined,
                  borderBottomLeftRadius: idx === suggested.length - 1 ? 7 : undefined,
                  borderBottomRightRadius: idx === suggested.length - 1 ? 7 : undefined,
                }}>
                  <span style={{ fontSize: 12, color: '#888', whiteSpace: 'nowrap', minWidth: 80 }}>{t.date}</span>
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{t.original_description || t.merchant_name || t.name}</div>
                    {t.pending && <div style={{ fontSize: 11, color: '#6366f1', fontWeight: 600 }}>PENDING</div>}
                    {t.source === 'csv' && <div style={{ fontSize: 10, color: '#64748b', background: '#f1f5f9', padding: '1px 5px', borderRadius: 4, fontWeight: 600, display: 'inline-block' }}>CSV</div>}
                    <AccountBadge t={t} />
                    {noteOpen[t.transaction_id] ? (
                      <div style={{ marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          type="text"
                          value={noteInput[t.transaction_id] ?? ''}
                          onChange={e => setNoteInput(prev => ({ ...prev, [t.transaction_id]: e.target.value }))}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleSaveNote(t.transaction_id)
                            if (e.key === 'Escape') setNoteOpen(prev => ({ ...prev, [t.transaction_id]: false }))
                          }}
                          placeholder="Add a note…"
                          autoFocus
                          style={{ fontSize: 12, padding: '2px 6px', border: '1px solid #d1d5db', borderRadius: 4, width: 180 }}
                        />
                        <button onClick={() => handleSaveNote(t.transaction_id)} disabled={noteSaving[t.transaction_id]} className="btn btn-primary btn-sm">{noteSaving[t.transaction_id] ? '…' : 'Save'}</button>
                        <button onClick={() => setNoteOpen(prev => ({ ...prev, [t.transaction_id]: false }))} className="btn btn-muted btn-sm">Cancel</button>
                      </div>
                    ) : (
                      <div style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                        {t.notes && <span style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📝 {t.notes}</span>}
                        <button
                          onClick={() => { setNoteInput(prev => ({ ...prev, [t.transaction_id]: t.notes || '' })); setNoteOpen(prev => ({ ...prev, [t.transaction_id]: true })) }}
                          style={{ fontSize: 11, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', padding: '1px 4px' }}
                          title={t.notes ? 'Edit note' : 'Add note'}
                        >{t.notes ? '✏' : '+ note'}</button>
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 13, color: t.amount > 0 ? '#ef4444' : '#10b981', whiteSpace: 'nowrap' }}>
                    {t.amount > 0 ? '-' : '+'}${Math.abs(t.amount).toFixed(2)}
                  </span>
                  {editing === t.transaction_id ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <CategorySelect value={newBudgetSubCategory} onChange={setNewBudgetSubCategory} categories={categories || []} />
                      <button onClick={() => handleSave(t.transaction_id)} className="btn btn-primary btn-sm">Save</button>
                      <button onClick={cancelEdit} className="btn btn-muted btn-sm">Cancel</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span style={{ background: '#dcfce7', color: '#15803d', padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block' }}>
                        {t.budget_sub_category}
                      </span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => handleMarkReviewed(t)} className="btn btn-success btn-sm">✓ Accept</button>
                        <button onClick={() => startEdit(t)} className="btn btn-ghost-accent btn-sm">Change</button>
                        <button onClick={() => handleRejectSuggestion(t)} className="btn btn-ghost-danger btn-sm" title="Wrong category — move to Needs Category">✗ Defer</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* ── Group B: Needs Category (review mode only) ── */}
      {reviewMode && (() => {
        const uncategorized = visible.filter(t => t.needs_review && !t.budget_sub_category)
        if (uncategorized.length === 0) return null
        return (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              Needs Category ({uncategorized.length})
            </div>
            <div style={{ border: '1px solid #fed7aa', borderRadius: 8 }}>
              {uncategorized.map((t, idx) => (
                <div key={t.transaction_id} style={{
                  borderTop: idx > 0 ? '1px solid #ffedd5' : undefined,
                  background: '#fff',
                  borderTopLeftRadius: idx === 0 ? 7 : undefined,
                  borderTopRightRadius: idx === 0 ? 7 : undefined,
                  borderBottomLeftRadius: idx === uncategorized.length - 1 ? 7 : undefined,
                  borderBottomRightRadius: idx === uncategorized.length - 1 ? 7 : undefined,
                }}>
                  {/* Main row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, color: '#888', whiteSpace: 'nowrap', minWidth: 80 }}>{t.date}</span>
                    <div style={{ flex: 1, minWidth: 120 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{t.original_description || t.merchant_name || t.name}</div>
                      {t.pending && <div style={{ fontSize: 11, color: '#6366f1', fontWeight: 600 }}>PENDING</div>}
                      {t.source === 'csv' && <div style={{ fontSize: 10, color: '#64748b', background: '#f1f5f9', padding: '1px 5px', borderRadius: 4, fontWeight: 600, display: 'inline-block' }}>CSV</div>}
                      <AccountBadge t={t} />
                      {noteOpen[t.transaction_id] ? (
                        <div style={{ marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            type="text"
                            value={noteInput[t.transaction_id] ?? ''}
                            onChange={e => setNoteInput(prev => ({ ...prev, [t.transaction_id]: e.target.value }))}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleSaveNote(t.transaction_id)
                              if (e.key === 'Escape') setNoteOpen(prev => ({ ...prev, [t.transaction_id]: false }))
                            }}
                            placeholder="Add a note…"
                            autoFocus
                            style={{ fontSize: 12, padding: '2px 6px', border: '1px solid #d1d5db', borderRadius: 4, width: 180 }}
                          />
                          <button onClick={() => handleSaveNote(t.transaction_id)} disabled={noteSaving[t.transaction_id]} className="btn btn-primary btn-sm">{noteSaving[t.transaction_id] ? '…' : 'Save'}</button>
                          <button onClick={() => setNoteOpen(prev => ({ ...prev, [t.transaction_id]: false }))} className="btn btn-muted btn-sm">Cancel</button>
                        </div>
                      ) : (
                        <div style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                          {t.notes && <span style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📝 {t.notes}</span>}
                          <button
                            onClick={() => { setNoteInput(prev => ({ ...prev, [t.transaction_id]: t.notes || '' })); setNoteOpen(prev => ({ ...prev, [t.transaction_id]: true })) }}
                            style={{ fontSize: 11, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', padding: '1px 4px' }}
                            title={t.notes ? 'Edit note' : 'Add note'}
                          >{t.notes ? '✏' : '+ note'}</button>
                        </div>
                      )}
                    </div>
                    <span style={{ fontSize: 13, color: t.amount > 0 ? '#ef4444' : '#10b981', whiteSpace: 'nowrap' }}>
                      {t.amount > 0 ? '-' : '+'}${Math.abs(t.amount).toFixed(2)}
                    </span>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <CategorySelect
                        value={editing === t.transaction_id ? newBudgetSubCategory : null}
                        onChange={(val) => { setEditing(t.transaction_id); setNewBudgetSubCategory(val) }}
                        categories={categories || []}
                        placeholder="Pick a category…"
                      />
                      {editing === t.transaction_id && newBudgetSubCategory && (
                        <button onClick={() => handleSave(t.transaction_id)} className="btn btn-primary btn-sm">Save</button>
                      )}
                      <button
                        onClick={() => toggleKwOpen(t)}
                        className="btn btn-ghost-accent btn-sm"
                        title="Add a keyword so future transactions like this are auto-categorized"
                        style={{ color: kwOpen[t.transaction_id] ? '#6366f1' : undefined }}
                      >
                        💡 {kwOpen[t.transaction_id] ? 'Cancel' : 'Add keyword'}
                      </button>
                    </div>
                  </div>

                  {/* Inline keyword form */}
                  {kwOpen[t.transaction_id] && (
                    <div style={{ padding: '10px 12px 12px', borderTop: '1px solid #ffedd5', background: '#fffbf5' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#92400e', marginBottom: 8 }}>
                        Add keyword rule — when a transaction name contains this keyword, assign it to the chosen category
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                          type="text"
                          value={kwInput[t.transaction_id] || ''}
                          onChange={e => setKwInput(prev => ({ ...prev, [t.transaction_id]: e.target.value }))}
                          onKeyDown={e => e.key === 'Enter' && handleAddAndTest(t)}
                          placeholder="keyword"
                          style={{
                            fontSize: 13, padding: '4px 8px',
                            border: '1px solid #d1d5db', borderRadius: 6,
                            width: 170, outline: 'none',
                          }}
                          autoFocus
                        />
                        <span style={{ fontSize: 12, color: '#aaa' }}>→</span>
                        <CategorySelect
                          value={kwCategory[t.transaction_id] || null}
                          onChange={val => setKwCategory(prev => ({ ...prev, [t.transaction_id]: val }))}
                          categories={categories || []}
                          placeholder="Pick category…"
                        />
                        <button
                          onClick={() => handleAddAndTest(t)}
                          disabled={!kwInput[t.transaction_id]?.trim() || !kwCategory[t.transaction_id] || kwStatus[t.transaction_id] === 'loading'}
                          className="btn btn-primary btn-sm"
                        >
                          {kwStatus[t.transaction_id] === 'loading' ? '…' : 'Add & Test'}
                        </button>
                      </div>
                      {kwStatus[t.transaction_id] === 'success' && (
                        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, color: '#15803d', fontWeight: 500 }}>
                            ✓ Matched — {kwCount[t.transaction_id]} transaction{kwCount[t.transaction_id] !== 1 ? 's' : ''} updated
                          </span>
                          <button
                            onClick={() => handleUndoKeyword(t.transaction_id)}
                            className="btn btn-ghost-danger btn-sm"
                            style={{ fontSize: 11 }}
                          >
                            Undo
                          </button>
                        </div>
                      )}
                      {kwStatus[t.transaction_id] === 'no-match' && (
                        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, color: '#b45309' }}>
                            {kwCount[t.transaction_id] > 0
                              ? `Keyword saved — ${kwCount[t.transaction_id]} other transaction${kwCount[t.transaction_id] !== 1 ? 's' : ''} updated (didn't match this one)`
                              : 'Keyword saved — no unlabeled transactions matched, check spelling or try a broader term'}
                          </span>
                          {kwCount[t.transaction_id] > 0 && (
                            <button
                              onClick={() => handleUndoKeyword(t.transaction_id)}
                              className="btn btn-ghost-danger btn-sm"
                              style={{ fontSize: 11 }}
                            >
                              Undo
                            </button>
                          )}
                        </div>
                      )}
                      {kwStatus[t.transaction_id] === 'undoing' && (
                        <div style={{ marginTop: 6, fontSize: 12, color: '#888' }}>Reverting…</div>
                      )}
                      {kwStatus[t.transaction_id] === 'conflict' && (
                        <div style={{ marginTop: 6, fontSize: 12, color: '#dc2626' }}>
                          That keyword is already assigned to another category
                        </div>
                      )}
                      {kwStatus[t.transaction_id] === 'error' && (
                        <div style={{ marginTop: 6, fontSize: 12, color: '#dc2626' }}>
                          Something went wrong — please try again
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* ── Desktop table view (non-review mode, or just-reviewed rows) ── */}
      <div className="txn-table-wrap">
        <table className="txn-table">
          <thead>
            <tr>
              {['Date', 'Merchant', 'Amount', 'Category', 'Actions'].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(reviewMode ? visible.filter(t => !t.needs_review) : visible).map((t) => {
              const hasSplits = t.splits?.length > 0
              return (
                <>
                  <tr key={t.transaction_id} style={{ borderTop: '1px solid #ddd', background: t._justReviewed ? '#f0fdf4' : hasSplits ? '#fdfaf3' : undefined, opacity: t._justReviewed ? 0.7 : 1 }}>
                    <td style={{ verticalAlign: 'top' }}>{t.date}</td>
                    <td style={{ verticalAlign: 'top' }}>
                      <div style={{ fontWeight: hasSplits ? 600 : undefined }}>{t.original_description || t.merchant_name || t.name}</div>
                      {t.pending && <div style={{ fontSize: 11, color: '#6366f1', fontWeight: 600, marginTop: 2 }}>PENDING</div>}
                      {t.source === 'csv' && <div style={{ fontSize: 10, color: '#64748b', background: '#f1f5f9', padding: '1px 5px', borderRadius: 4, fontWeight: 600, marginTop: 2, display: 'inline-block' }}>CSV</div>}
                      {hasSplits && <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600, marginTop: 2 }}>SPLIT ({t.splits.length})</div>}
                      {t.amazon_order && (
                        <button onClick={() => toggleAmazon(t.transaction_id)} style={{ marginTop: 3, fontSize: 11, color: '#f97316', background: 'none', border: '1px solid #fed7aa', borderRadius: 4, padding: '1px 7px', cursor: 'pointer', fontWeight: 600 }}>
                          📦 {t.amazon_order.items?.length > 0 ? `${t.amazon_order.items.length} item${t.amazon_order.items.length !== 1 ? 's' : ''}` : 'Amazon order'} {expandedAmazon.has(t.transaction_id) ? '▲' : '▼'}
                        </button>
                      )}
                      <AccountBadge t={t} />
                      {noteOpen[t.transaction_id] ? (
                        <div style={{ marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            type="text"
                            value={noteInput[t.transaction_id] ?? ''}
                            onChange={e => setNoteInput(prev => ({ ...prev, [t.transaction_id]: e.target.value }))}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleSaveNote(t.transaction_id)
                              if (e.key === 'Escape') setNoteOpen(prev => ({ ...prev, [t.transaction_id]: false }))
                            }}
                            placeholder="Add a note…"
                            autoFocus
                            style={{ fontSize: 12, padding: '2px 6px', border: '1px solid #d1d5db', borderRadius: 4, width: 200 }}
                          />
                          <button onClick={() => handleSaveNote(t.transaction_id)} disabled={noteSaving[t.transaction_id]} className="btn btn-primary btn-sm">
                            {noteSaving[t.transaction_id] ? '…' : 'Save'}
                          </button>
                          <button onClick={() => setNoteOpen(prev => ({ ...prev, [t.transaction_id]: false }))} className="btn btn-muted btn-sm">Cancel</button>
                        </div>
                      ) : (
                        <div style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                          {t.notes && <span style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📝 {t.notes}</span>}
                          <button
                            onClick={() => { setNoteInput(prev => ({ ...prev, [t.transaction_id]: t.notes || '' })); setNoteOpen(prev => ({ ...prev, [t.transaction_id]: true })) }}
                            style={{ fontSize: 11, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', padding: '1px 4px' }}
                            title={t.notes ? 'Edit note' : 'Add note'}
                          >
                            {t.notes ? '✏' : '+ note'}
                          </button>
                        </div>
                      )}
                    </td>
                    <td style={{ color: t.amount > 0 ? '#ef4444' : '#10b981', verticalAlign: 'top' }}>
                      {t.amount > 0 ? '-' : '+'}${Math.abs(t.amount).toFixed(2)}
                    </td>
                    <td style={{ verticalAlign: 'top' }}>
                      {hasSplits ? (
                        <span style={{ fontSize: 12, color: '#888', fontStyle: 'italic' }}>see splits below</span>
                      ) : editing === t.transaction_id ? (
                        <CategorySelect value={newBudgetSubCategory} onChange={setNewBudgetSubCategory} categories={categories || []} />
                      ) : (
                        <CategoryPill t={t} />
                      )}
                    </td>
                    <td style={{ verticalAlign: 'top' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {editing === t.transaction_id ? (
                          <>
                            <button onClick={() => handleSave(t.transaction_id)} className="btn btn-primary btn-sm">Save</button>
                            <button onClick={cancelEdit} className="btn btn-muted btn-sm">Cancel</button>
                          </>
                        ) : (
                          <>
                            {t._justReviewed && (
                              <button onClick={() => handleUndoReviewed(t.transaction_id)} className="btn btn-muted btn-sm" title="Undo — re-flag for review">↩ Undo</button>
                            )}
                            {!hasSplits && <button onClick={() => startEdit(t)} className="btn btn-primary btn-sm">Relabel</button>}
                            <button onClick={() => setSplitting(t)} className="btn btn-warning btn-sm">{hasSplits ? 'Edit Splits' : 'Split'}</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {hasSplits && t.splits.map((s, i) => (
                    <tr key={`${t.transaction_id}-split-${s.id}`} style={{ background: '#fffbeb', borderBottom: i === t.splits.length - 1 ? '2px solid #fde68a' : undefined }}>
                      <td style={{ fontSize: 12, color: '#aaa', paddingLeft: 24 }}>{i === 0 ? '└' : ' '}</td>
                      <td style={{ fontSize: 13, color: '#555' }}>
                        <span style={{ marginRight: 6, color: '#d97706' }}>↳</span>
                        {s.note || <span style={{ fontStyle: 'italic', color: '#aaa' }}>no note</span>}
                      </td>
                      <td style={{ fontSize: 13, color: '#ef4444' }}>-${s.amount.toFixed(2)}</td>
                      <td><SplitCategoryPill s={s} /></td>
                      <td />
                    </tr>
                  ))}
                  {t.amazon_order && expandedAmazon.has(t.transaction_id) && (
                    <tr key={`${t.transaction_id}-amazon`} style={{ background: '#fff7ed' }}>
                      <td />
                      <td colSpan={4} style={{ paddingBottom: 10, paddingRight: 12 }}>
                        <AmazonOrderPanel order={t.amazon_order} onUnlink={() => handleAmazonUnlink(t.transaction_id, t.amazon_order.id)} />
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Mobile card view ── */}
      <div className="txn-cards">
        {(reviewMode ? visible.filter(t => !t.needs_review) : visible).map((t) => {
          const hasSplits = t.splits?.length > 0
          return (
            <div key={t.transaction_id} className="txn-card" style={{ background: t._justReviewed ? '#f0fdf4' : hasSplits ? '#fdfaf3' : undefined, opacity: t._justReviewed ? 0.7 : 1 }}>
              <div className="txn-card-top">
                <div style={{ flex: 1 }}>
                  <div className="txn-card-merchant">{t.original_description || t.merchant_name || t.name}</div>
                  {t.pending && <div style={{ fontSize: 11, color: '#6366f1', fontWeight: 600, marginTop: 2 }}>PENDING</div>}
                  {t.source === 'csv' && <div style={{ fontSize: 10, color: '#64748b', background: '#f1f5f9', padding: '1px 5px', borderRadius: 4, fontWeight: 600, marginTop: 2, display: 'inline-block' }}>CSV</div>}
                  {hasSplits && <div className="txn-split-badge">SPLIT ({t.splits.length})</div>}
                  {t.amazon_order && (
                    <button onClick={() => toggleAmazon(t.transaction_id)} style={{ marginTop: 3, fontSize: 11, color: '#f97316', background: 'none', border: '1px solid #fed7aa', borderRadius: 4, padding: '1px 7px', cursor: 'pointer', fontWeight: 600 }}>
                      📦 {t.amazon_order.items?.length > 0 ? `${t.amazon_order.items.length} item${t.amazon_order.items.length !== 1 ? 's' : ''}` : 'Amazon order'} {expandedAmazon.has(t.transaction_id) ? '▲' : '▼'}
                    </button>
                  )}
                </div>
                <span className="txn-card-amount" style={{ color: t.amount > 0 ? '#ef4444' : '#10b981' }}>
                  {t.amount > 0 ? '-' : '+'}${Math.abs(t.amount).toFixed(2)}
                </span>
              </div>

              <div className="txn-card-meta">
                <span className="txn-card-date">{t.date}</span>
                <AccountBadge t={t} />
                {!hasSplits && (
                  editing === t.transaction_id
                    ? <CategorySelect value={newBudgetSubCategory} onChange={setNewBudgetSubCategory} categories={categories || []} />
                    : <CategoryPill t={t} />
                )}
              </div>

              {noteOpen[t.transaction_id] ? (
                <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="text"
                    value={noteInput[t.transaction_id] ?? ''}
                    onChange={e => setNoteInput(prev => ({ ...prev, [t.transaction_id]: e.target.value }))}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleSaveNote(t.transaction_id)
                      if (e.key === 'Escape') setNoteOpen(prev => ({ ...prev, [t.transaction_id]: false }))
                    }}
                    placeholder="Add a note…"
                    autoFocus
                    style={{ fontSize: 12, padding: '2px 6px', border: '1px solid #d1d5db', borderRadius: 4, flex: 1 }}
                  />
                  <button onClick={() => handleSaveNote(t.transaction_id)} disabled={noteSaving[t.transaction_id]} className="btn btn-primary btn-sm">
                    {noteSaving[t.transaction_id] ? '…' : 'Save'}
                  </button>
                  <button onClick={() => setNoteOpen(prev => ({ ...prev, [t.transaction_id]: false }))} className="btn btn-muted btn-sm">Cancel</button>
                </div>
              ) : (
                <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {t.notes && <span style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📝 {t.notes}</span>}
                  <button
                    onClick={() => { setNoteInput(prev => ({ ...prev, [t.transaction_id]: t.notes || '' })); setNoteOpen(prev => ({ ...prev, [t.transaction_id]: true })) }}
                    style={{ fontSize: 11, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', padding: '1px 4px' }}
                    title={t.notes ? 'Edit note' : 'Add note'}
                  >
                    {t.notes ? '✏' : '+ note'}
                  </button>
                </div>
              )}

              {hasSplits && (
                <div className="txn-split-rows">
                  {t.splits.map((s) => (
                    <div key={s.id} className="txn-split-row">
                      <div className="txn-split-info">
                        <span style={{ color: '#d97706', marginRight: 4 }}>↳</span>
                        {s.note || <em style={{ color: '#aaa' }}>no note</em>}
                        <div style={{ marginTop: 2 }}><SplitCategoryPill s={s} /></div>
                      </div>
                      <span className="txn-split-amount">-${s.amount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}

              {t.amazon_order && expandedAmazon.has(t.transaction_id) && (
                <div style={{ marginTop: 8 }}>
                  <AmazonOrderPanel order={t.amazon_order} />
                </div>
              )}

              <div className="txn-card-actions" style={{ marginTop: 8 }}>
                {editing === t.transaction_id ? (
                  <>
                    <button onClick={() => handleSave(t.transaction_id)} className="btn btn-primary btn-sm">Save</button>
                    <button onClick={cancelEdit} className="btn btn-muted btn-sm">Cancel</button>
                  </>
                ) : (
                  <>
                    {t._justReviewed && (
                      <button onClick={() => handleUndoReviewed(t.transaction_id)} className="btn btn-muted btn-sm" title="Undo — re-flag for review">↩ Undo</button>
                    )}
                    {!hasSplits && <button onClick={() => startEdit(t)} className="btn btn-primary btn-sm">Relabel</button>}
                    <button onClick={() => setSplitting(t)} className="btn btn-warning btn-sm">{hasSplits ? 'Edit Splits' : 'Split'}</button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {visible.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">📄</div>
          <div className="empty-state-title">No transactions found</div>
          <div className="empty-state-desc">
            {selectedAccounts.size > 0 || amazonFilter
              ? 'Try clearing the filters above'
              : reviewMode ? 'All caught up — nothing needs review'
              : 'Adjust the date range or connect an account'}
          </div>
        </div>
      )}

      {hasMore && (
        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <button onClick={onLoadMore} className="btn btn-ghost-accent btn-lg">
            Load more transactions
          </button>
        </div>
      )}
    </>
  )
}

function AccountBadge({ t }) {
  if (!t.account_name && !t.institution_name) return null
  const label = [t.account_name, t.account_mask ? `••••${t.account_mask}` : null]
    .filter(Boolean).join(' ')
  return (
    <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
      {t.institution_name ? `${t.institution_name}` : ''}{label ? ` · ${label}` : ''}
    </div>
  )
}

function CategoryPill({ t }) {
  if (t.budget_sub_category) {
    const breadcrumb = [t.budget_macro_category, t.budget_category].filter(Boolean).join(' › ')
    return (
      <div>
        {breadcrumb && <div className="cat-breadcrumb">{breadcrumb}</div>}
        <span style={{ background: '#e8eaf6', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600 }}>{t.budget_sub_category}</span>
      </div>
    )
  }
  return (
    <span style={{ background: '#f3f4f6', color: '#9ca3af', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontStyle: 'italic' }}>
      Uncategorized
    </span>
  )
}

function SplitCategoryPill({ s }) {
  return (
    <div>
      {s.budget_macro_category && <div className="cat-breadcrumb">{s.budget_macro_category}</div>}
      {s.budget_category && <div className="cat-name-small">{s.budget_category}</div>}
      <span style={{ background: '#fde68a', color: '#92400e', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600 }}>
        {s.budget_sub_category || s.category}
      </span>
    </div>
  )
}

function AmazonOrderPanel({ order, onUnlink }) {
  const sub = order.subtotals || {}
  const hasSubtotals = sub.item_subtotal != null || sub.shipping != null || sub.tax != null
  return (
    <div style={{ background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 6, padding: '10px 12px', fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        {order.order_total != null && (
          <span style={{ fontWeight: 700, fontSize: 14, color: '#111' }}>${order.order_total.toFixed(2)}</span>
        )}
        {hasSubtotals && (
          <span style={{ color: '#888' }}>
            {sub.item_subtotal != null && `items $${sub.item_subtotal.toFixed(2)}`}
            {sub.shipping != null && ` · shipping $${sub.shipping.toFixed(2)}`}
            {sub.tax != null && ` · tax $${sub.tax.toFixed(2)}`}
          </span>
        )}
        <span style={{ color: '#bbb', fontFamily: 'monospace', marginLeft: 4 }}>#{order.order_id}</span>
        {order.gmail_message_id && (
          <a
            href={`https://mail.google.com/mail/u/0/#all/${order.gmail_message_id}`}
            target="_blank" rel="noopener noreferrer"
            style={{ color: '#6366f1', textDecoration: 'none', marginLeft: 4 }}
          >
            view email ↗
          </a>
        )}
        {onUnlink && (
          <button
            onClick={onUnlink}
            style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af', background: 'none', border: '1px solid #e5e7eb', borderRadius: 4, padding: '1px 8px', cursor: 'pointer' }}
          >
            Unlink
          </button>
        )}
      </div>
      {order.items?.length > 0 && (
        <div style={{ color: '#555', lineHeight: '1.6' }}>
          {order.items.map((item, i) => (
            <div key={i}>· {item.description}{item.quantity > 1 ? ` (×${item.quantity})` : ''}</div>
          ))}
        </div>
      )}
    </div>
  )
}

