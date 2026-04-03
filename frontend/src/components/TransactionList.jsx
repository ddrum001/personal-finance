import { useState, useMemo } from 'react'
import { updateBudgetCategory, markReviewed, markReviewedBulk, flagForReview } from '../api/client'
import SplitModal from './SplitModal'
import CategorySelect from './CategorySelect'

export default function TransactionList({ transactions, onUpdated, categories, reviewMode, splitQueueMode }) {
  const [editing, setEditing] = useState(null)
  const [newBudgetSubCategory, setNewBudgetSubCategory] = useState(null)
  const [splitting, setSplitting] = useState(null)
  const [selectedInstitution, setSelectedInstitution] = useState(null)
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [markingAll, setMarkingAll] = useState(false)
  // Map of id → transaction snapshot for transactions reviewed this session
  // Keeps them visible in review mode so the undo button can be clicked
  const [reviewedThisSession, setReviewedThisSession] = useState(new Map())

  const handleSave = async (id) => {
    if (newBudgetSubCategory) await updateBudgetCategory(id, newBudgetSubCategory)
    setEditing(null)
    setNewBudgetSubCategory(null)
    onUpdated?.()
  }

  const handleMarkReviewed = async (txn) => {
    await markReviewed(txn.transaction_id)
    setReviewedThisSession((prev) => new Map(prev).set(txn.transaction_id, txn))
    onUpdated?.()
  }

  const handleUndoReviewed = async (id) => {
    await flagForReview(id)
    setReviewedThisSession((prev) => { const m = new Map(prev); m.delete(id); return m })
    onUpdated?.()
  }

  const handleMarkAllReviewed = async () => {
    setMarkingAll(true)
    const ids = visible.filter(t => t.needs_review).map(t => t.transaction_id)
    if (ids.length) await markReviewedBulk(ids)
    setMarkingAll(false)
    onUpdated?.()
  }

  const startEdit = (t) => { setEditing(t.transaction_id); setNewBudgetSubCategory(t.budget_sub_category || null) }
  const cancelEdit = () => { setEditing(null); setNewBudgetSubCategory(null) }

  // Build institution → accounts map from the transaction data itself
  const institutions = useMemo(() => {
    const map = new Map()
    transactions.forEach((t) => {
      if (!t.institution_name) return
      if (!map.has(t.institution_name)) map.set(t.institution_name, new Map())
      if (t.account_id && !map.get(t.institution_name).has(t.account_id)) {
        map.get(t.institution_name).set(t.account_id, { account_id: t.account_id, name: t.account_name, mask: t.account_mask })
      }
    })
    return [...map.entries()].map(([name, accts]) => ({ name, accounts: [...accts.values()] }))
  }, [transactions])

  const selectInstitution = (name) => {
    setSelectedInstitution(name === selectedInstitution ? null : name)
    setSelectedAccount(null)
  }
  const selectAccount = (id) => {
    setSelectedAccount(id === selectedAccount ? null : id)
  }

  const currentIds = useMemo(() => new Set(transactions.map((t) => t.transaction_id)), [transactions])

  // In review mode, keep recently-reviewed rows visible (with undo button) even after parent re-fetch removes them
  const recentlyReviewedRows = useMemo(() => {
    if (!reviewMode) return []
    return [...reviewedThisSession.entries()]
      .filter(([id]) => !currentIds.has(id))
      .map(([, txn]) => ({ ...txn, needs_review: false, _justReviewed: true }))
  }, [reviewMode, reviewedThisSession, currentIds])

  const visible = [
    ...transactions.filter((t) => {
      if (selectedAccount) return t.account_id === selectedAccount
      if (selectedInstitution) return t.institution_name === selectedInstitution
      return true
    }),
    ...recentlyReviewedRows,
  ]

  const accountsForSelected = selectedInstitution
    ? institutions.find((i) => i.name === selectedInstitution)?.accounts ?? []
    : []

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
      {institutions.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#888', marginRight: 4 }}>Institution:</span>
            {institutions.map((inst) => (
              <button
                key={inst.name}
                onClick={() => selectInstitution(inst.name)}
                style={{
                  padding: '4px 12px', border: '1px solid #ddd', borderRadius: 20, fontSize: 12,
                  cursor: 'pointer', fontWeight: 600,
                  background: selectedInstitution === inst.name ? '#6366f1' : '#fff',
                  color: selectedInstitution === inst.name ? '#fff' : '#444',
                }}
              >
                {inst.name}
              </button>
            ))}
            {selectedInstitution && (
              <button
                onClick={() => { setSelectedInstitution(null); setSelectedAccount(null) }}
                style={{ padding: '4px 10px', border: 'none', background: 'none', color: '#6366f1', fontSize: 12, cursor: 'pointer' }}
              >
                Clear ×
              </button>
            )}
          </div>

          {accountsForSelected.length > 1 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 6, paddingLeft: 8 }}>
              <span style={{ fontSize: 12, color: '#aaa', marginRight: 4 }}>Account:</span>
              {accountsForSelected.map((a) => (
                <button
                  key={a.account_id}
                  onClick={() => selectAccount(a.account_id)}
                  style={{
                    padding: '3px 10px', border: '1px solid #e5e7eb', borderRadius: 20, fontSize: 12,
                    cursor: 'pointer',
                    background: selectedAccount === a.account_id ? '#6366f1' : '#f9fafb',
                    color: selectedAccount === a.account_id ? '#fff' : '#555',
                  }}
                >
                  {a.name || 'Account'}{a.mask ? ` ••••${a.mask}` : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Split queue banner */}
      {splitQueueMode && (
        <div style={{ background: '#fdf4ff', border: '1px solid #d8b4fe', borderRadius: 8, padding: '10px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 13, color: '#7e22ce', fontWeight: 600 }}>
            ✂ {visible.length} transaction{visible.length !== 1 ? 's' : ''} need splitting
          </span>
          <span style={{ fontSize: 12, color: '#9333ea' }}>Click Split on each row to apply a template or create custom splits</span>
        </div>
      )}

      {/* Review mode banner */}
      {reviewMode && (
        <div style={{ background: '#fef9c3', border: '1px solid #fde047', borderRadius: 8, padding: '10px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 13, color: '#854d0e', fontWeight: 600 }}>
            ⚠ {visible.length} transaction{visible.length !== 1 ? 's' : ''} need review
          </span>
          {visible.length > 0 && (
            <button
              onClick={handleMarkAllReviewed}
              disabled={markingAll}
              style={{ padding: '5px 14px', background: '#854d0e', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
            >
              {markingAll ? 'Marking…' : `Mark all ${visible.length} reviewed`}
            </button>
          )}
        </div>
      )}

      <div style={{ fontSize: 13, color: '#888', marginBottom: 12 }}>
        {visible.length} transaction{visible.length !== 1 ? 's' : ''}
        {(selectedInstitution || selectedAccount) ? ' (filtered)' : ''}
      </div>

      {/* ── Desktop table view ── */}
      <div className="txn-table-wrap">
        <table className="txn-table">
          <thead>
            <tr style={{ background: '#e8eaf6' }}>
              {['Date', 'Merchant', 'Amount', 'Category', 'Actions'].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => {
              const hasSplits = t.splits?.length > 0
              return (
                <>
                  <tr key={t.transaction_id} style={{ borderTop: '1px solid #ddd', background: t._justReviewed ? '#f0fdf4' : hasSplits ? '#fdfaf3' : undefined, opacity: t._justReviewed ? 0.7 : 1 }}>
                    <td style={{ verticalAlign: 'top' }}>{t.date}</td>
                    <td style={{ verticalAlign: 'top' }}>
                      <div style={{ fontWeight: hasSplits ? 600 : undefined }}>{t.merchant_name || t.name}</div>
                      {t.needs_review && <div style={{ fontSize: 11, color: '#92400e', fontWeight: 600, marginTop: 2, background: '#fef9c3', display: 'inline-block', padding: '1px 6px', borderRadius: 4 }}>NEEDS REVIEW</div>}
                      {hasSplits && <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600, marginTop: 2 }}>SPLIT ({t.splits.length})</div>}
                      <AccountBadge t={t} />
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
                            <button onClick={() => handleSave(t.transaction_id)} style={btnStyle('#6366f1')}>Save</button>
                            <button onClick={cancelEdit} style={btnStyle('#888')}>Cancel</button>
                          </>
                        ) : (
                          <>
                            {t.needs_review && (
                              <button onClick={() => handleMarkReviewed(t)} style={btnStyle('#854d0e')}>✓ Reviewed</button>
                            )}
                            {t._justReviewed && (
                              <button onClick={() => handleUndoReviewed(t.transaction_id)} style={btnStyle('#6b7280')} title="Undo — re-flag for review">↩ Undo</button>
                            )}
                            {!hasSplits && <button onClick={() => startEdit(t)} style={btnStyle('#6366f1')}>Relabel</button>}
                            <button onClick={() => setSplitting(t)} style={btnStyle('#f59e0b')}>{hasSplits ? 'Edit Splits' : 'Split'}</button>
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
                </>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Mobile card view ── */}
      <div className="txn-cards">
        {visible.map((t) => {
          const hasSplits = t.splits?.length > 0
          return (
            <div key={t.transaction_id} className="txn-card" style={{ background: t._justReviewed ? '#f0fdf4' : hasSplits ? '#fdfaf3' : undefined, opacity: t._justReviewed ? 0.7 : 1 }}>
              <div className="txn-card-top">
                <div style={{ flex: 1 }}>
                  <div className="txn-card-merchant">{t.merchant_name || t.name}</div>
                  {t.needs_review && <div style={{ fontSize: 11, color: '#92400e', fontWeight: 600, marginTop: 2, background: '#fef9c3', display: 'inline-block', padding: '1px 6px', borderRadius: 4 }}>NEEDS REVIEW</div>}
                  {hasSplits && <div className="txn-split-badge">SPLIT ({t.splits.length})</div>}
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

              <div className="txn-card-actions" style={{ marginTop: 8 }}>
                {editing === t.transaction_id ? (
                  <>
                    <button onClick={() => handleSave(t.transaction_id)} style={btnStyle('#6366f1')}>Save</button>
                    <button onClick={cancelEdit} style={btnStyle('#888')}>Cancel</button>
                  </>
                ) : (
                  <>
                    {t.needs_review && (
                      <button onClick={() => handleMarkReviewed(t)} style={btnStyle('#854d0e')}>✓ Reviewed</button>
                    )}
                    {t._justReviewed && (
                      <button onClick={() => handleUndoReviewed(t.transaction_id)} style={btnStyle('#6b7280')} title="Undo — re-flag for review">↩ Undo</button>
                    )}
                    {!hasSplits && <button onClick={() => startEdit(t)} style={btnStyle('#6366f1')}>Relabel</button>}
                    <button onClick={() => setSplitting(t)} style={btnStyle('#f59e0b')}>{hasSplits ? 'Edit Splits' : 'Split'}</button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
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

function btnStyle(bg) {
  return { padding: '4px 10px', background: bg, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }
}
