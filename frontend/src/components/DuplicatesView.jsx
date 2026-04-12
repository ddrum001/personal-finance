import { useState, useEffect } from 'react'
import { getDuplicateTransactions, deleteTransaction, dismissDuplicateGroup } from '../api/client'

const fmt = (n) => n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export default function DuplicatesView({ onResolved }) {
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(null)   // transaction_id awaiting delete confirm
  const [deleting, setDeleting] = useState(null)       // transaction_id being deleted
  const [dismissing, setDismissing] = useState(null)   // group index being dismissed
  const [error, setError] = useState(null)

  const load = async () => {
    setLoading(true); setError(null)
    try { setGroups(await getDuplicateTransactions()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (transactionId) => {
    setConfirming(null)
    setDeleting(transactionId)
    setError(null)
    try {
      await deleteTransaction(transactionId)
      setGroups(prev =>
        prev
          .map(g => ({ ...g, transactions: g.transactions.filter(t => t.transaction_id !== transactionId) }))
          .filter(g => g.transactions.length > 1)
      )
      onResolved?.()
    } catch (e) {
      setError(e.message)
      await load()
    } finally {
      setDeleting(null)
    }
  }

  const handleDismiss = async (gi) => {
    setDismissing(gi)
    setError(null)
    try {
      const ids = groups[gi].transactions.map(t => t.transaction_id)
      await dismissDuplicateGroup(ids)
      setGroups(prev => prev.filter((_, i) => i !== gi))
    } catch (e) {
      setError(e.message)
    } finally {
      setDismissing(null)
    }
  }

  if (loading) return <p className="loading-text">Scanning for potential duplicates…</p>
  if (error) return <p style={{ color: '#ef4444', fontSize: 13 }}>{error}</p>

  if (groups.length === 0) return (
    <div className="empty-state">
      <div className="empty-state-icon">✓</div>
      <div className="empty-state-title">No potential duplicates found</div>
      <div className="empty-state-desc">All transactions appear to be unique.</div>
    </div>
  )

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: '#555' }}>
        Found <strong>{groups.length}</strong> potential duplicate group{groups.length !== 1 ? 's' : ''} ({groups.reduce((s, g) => s + g.copies - 1, 0)} extra row{groups.reduce((s, g) => s + g.copies - 1, 0) !== 1 ? 's' : ''}).
        Delete the entry you want to remove, or dismiss the group if it's not a duplicate.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {groups.map((group, gi) => (
          <div key={gi} style={{ border: '1px solid #fde68a', borderRadius: 8, overflow: 'hidden' }}>

            {/* Group header */}
            <div style={{ background: '#fffbeb', padding: '8px 14px', borderBottom: '1px solid #fde68a', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 13, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.name}</span>
              <span style={{ fontSize: 13, color: '#555', flexShrink: 0 }}>{fmt(group.amount)}</span>
              <span style={{ fontSize: 12, color: '#888', flexShrink: 0 }}>{group.date}</span>
              <span style={{ fontSize: 11, background: '#fef3c7', color: '#92400e', padding: '1px 8px', borderRadius: 10, fontWeight: 600, flexShrink: 0 }}>
                {group.copies} copies
              </span>
              <button
                onClick={() => handleDismiss(gi)}
                disabled={dismissing === gi}
                className="btn btn-ghost btn-sm"
                style={{ flexShrink: 0, fontSize: 11 }}
              >
                {dismissing === gi ? 'Dismissing…' : 'Not a duplicate'}
              </button>
            </div>

            {/* Transaction cards — no table, stacks on mobile */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {group.transactions.map((t, ti) => (
                <div
                  key={t.transaction_id}
                  style={{
                    padding: '10px 14px',
                    borderBottom: ti < group.transactions.length - 1 ? '1px solid #f3f4f6' : 'none',
                    background: ti % 2 === 0 ? '#fff' : '#fafafa',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  {/* Row 1: account + date */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>
                      {t.account_name || '—'}
                      {t.account_mask && <span style={{ color: '#bbb', marginLeft: 4 }}>····{t.account_mask}</span>}
                      {t.pending && <span style={{ marginLeft: 6, fontSize: 10, color: '#f59e0b', background: '#fef3c7', padding: '1px 5px', borderRadius: 4 }}>pending</span>}
                    </span>
                    <span style={{ fontSize: 12, color: '#888', flexShrink: 0 }}>{t.date || '—'}</span>
                  </div>

                  {/* Row 2: institution + category */}
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: '#555' }}>
                    {t.institution_name && <span>{t.institution_name}</span>}
                    <span style={{ color: t.budget_sub_category ? '#555' : '#bbb' }}>
                      {t.budget_sub_category || 'Uncategorized'}
                    </span>
                  </div>

                  {/* Row 3: action */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
                    {deleting === t.transaction_id ? (
                      <span style={{ fontSize: 11, color: '#9ca3af' }}>Deleting…</span>
                    ) : confirming === t.transaction_id ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12, color: '#374151' }}>Delete this entry?</span>
                        <button onClick={() => handleDelete(t.transaction_id)} className="btn btn-danger btn-sm">Yes</button>
                        <button onClick={() => setConfirming(null)} className="btn btn-ghost btn-sm">No</button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirming(t.transaction_id)} className="btn btn-ghost-danger btn-sm">
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

          </div>
        ))}
      </div>
    </div>
  )
}
