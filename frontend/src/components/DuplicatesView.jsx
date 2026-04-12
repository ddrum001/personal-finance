import { useState, useEffect } from 'react'
import { getDuplicateTransactions, deleteTransaction } from '../api/client'

const fmt = (n) => n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export default function DuplicatesView({ onResolved }) {
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(null)  // transaction_id awaiting confirmation
  const [deleting, setDeleting] = useState(null)
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
      // Remove optimistically — no full reload needed
      setGroups(prev => {
        const next = prev
          .map(g => ({ ...g, transactions: g.transactions.filter(t => t.transaction_id !== transactionId) }))
          .filter(g => g.transactions.length > 1)
        return next
      })
      onResolved?.()
    } catch (e) {
      setError(e.message)
      await load() // only reload on error to restore consistent state
    } finally {
      setDeleting(null)
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
        Delete the entry you want to remove — typically the older one or the one from the wrong account.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {groups.map((group, gi) => (
          <div key={gi} style={{ border: '1px solid #fde68a', borderRadius: 8, overflow: 'hidden' }}>
            {/* Group header */}
            <div style={{ background: '#fffbeb', padding: '8px 14px', borderBottom: '1px solid #fde68a', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{group.name}</span>
              <span style={{ fontSize: 13, color: '#555' }}>{fmt(group.amount)}</span>
              <span style={{ fontSize: 12, color: '#888' }}>{group.date}</span>
              <span style={{ fontSize: 11, background: '#fef3c7', color: '#92400e', padding: '1px 8px', borderRadius: 10, fontWeight: 600 }}>
                {group.copies} copies
              </span>
            </div>

            {/* Individual transactions */}
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#9ca3af', borderBottom: '1px solid #f3f4f6' }}>
                  <th style={{ padding: '6px 14px', textAlign: 'left', fontWeight: 600 }}>Account</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>Institution</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>Category</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>Created</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>ID</th>
                  <th style={{ padding: '6px 14px', textAlign: 'right', fontWeight: 600 }}></th>
                </tr>
              </thead>
              <tbody>
                {group.transactions.map((t, ti) => (
                  <tr key={t.transaction_id} style={{ borderBottom: '1px solid #f9fafb', background: ti % 2 === 0 ? '#fff' : '#fafafa' }}>
                    <td style={{ padding: '7px 14px' }}>
                      {t.account_name || '—'}
                      {t.account_mask && <span style={{ color: '#bbb', marginLeft: 4 }}>····{t.account_mask}</span>}
                      {t.pending && <span style={{ marginLeft: 6, fontSize: 10, color: '#f59e0b', background: '#fef3c7', padding: '1px 5px', borderRadius: 4 }}>pending</span>}
                    </td>
                    <td style={{ padding: '7px 8px', color: '#555' }}>{t.institution_name || '—'}</td>
                    <td style={{ padding: '7px 8px', color: '#555' }}>{t.budget_sub_category || <span style={{ color: '#bbb' }}>Uncategorized</span>}</td>
                    <td style={{ padding: '7px 8px', color: '#9ca3af' }}>{t.created_at ? new Date(t.created_at).toLocaleDateString() : '—'}</td>
                    <td style={{ padding: '7px 8px', color: '#bbb', fontFamily: 'monospace', fontSize: 10 }}>{t.transaction_id.slice(0, 12)}…</td>
                    <td style={{ padding: '7px 14px', textAlign: 'right' }}>
                      {deleting === t.transaction_id ? (
                        <span style={{ fontSize: 11, color: '#9ca3af' }}>Deleting…</span>
                      ) : confirming === t.transaction_id ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ fontSize: 11, color: '#374151' }}>Sure?</span>
                          <button onClick={() => handleDelete(t.transaction_id)} className="btn btn-danger btn-sm">Yes</button>
                          <button onClick={() => setConfirming(null)} className="btn btn-ghost btn-sm">No</button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirming(t.transaction_id)} className="btn btn-ghost-danger btn-sm">
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  )
}
