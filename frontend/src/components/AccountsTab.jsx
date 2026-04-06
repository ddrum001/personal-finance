import { useState } from 'react'
import { updateAccountNickname, deleteItem, syncItem } from '../api/client'

function formatSyncTime(ts) {
  if (!ts) return 'Never'
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now - d
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffMins < 2) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString()
}

function displayName(acct) {
  if (acct.nickname) return acct.nickname
  // Prefer official_name if it's more descriptive than name
  const name = acct.official_name || acct.name
  return name
}

export default function AccountsTab({ items, onRefresh }) {
  const [editing, setEditing] = useState(null) // account_id being edited
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null) // item_id to confirm
  const [syncingItem, setSyncingItem] = useState(null) // item_id being synced
  const [syncResults, setSyncResults] = useState({}) // item_id → result string

  const startEdit = (acct) => {
    setEditing(acct.account_id)
    setDraft(acct.nickname || displayName(acct))
  }

  const cancelEdit = () => { setEditing(null); setDraft('') }

  const saveNickname = async (accountId) => {
    setSaving(true)
    try {
      await updateAccountNickname(accountId, draft.trim() || null)
      await onRefresh()
      setEditing(null)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteItem = async (itemId) => {
    await deleteItem(itemId)
    await onRefresh()
    setConfirmDelete(null)
  }

  const handleSyncItem = async (itemId) => {
    setSyncingItem(itemId)
    setSyncResults(prev => ({ ...prev, [itemId]: null }))
    try {
      const res = await syncItem(itemId)
      const parts = []
      if (res.added) parts.push(`+${res.added} added`)
      if (res.modified) parts.push(`${res.modified} updated`)
      if (res.removed) parts.push(`${res.removed} removed`)
      setSyncResults(prev => ({ ...prev, [itemId]: parts.length ? parts.join(' · ') : 'Up to date' }))
      await onRefresh()
    } catch (e) {
      setSyncResults(prev => ({ ...prev, [itemId]: `Error: ${e.message}` }))
    } finally {
      setSyncingItem(null)
    }
  }

  // Show Plaid items first, manual last
  const sorted = [...items].sort((a, b) => {
    const aManual = a.accounts.every(ac => ac.account_id.startsWith('manual'))
    const bManual = b.accounts.every(ac => ac.account_id.startsWith('manual'))
    if (aManual !== bManual) return aManual ? 1 : -1
    return (a.institution_name || '').localeCompare(b.institution_name || '')
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {sorted.map((item) => {
        const isManual = item.accounts.every(ac => ac.account_id.startsWith('manual'))
        return (
          <div key={item.item_id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
            {/* Institution header */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 16px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb',
            }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: 14 }}>
                  {item.institution_name || 'Unknown'}
                </span>
                {isManual && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: '#888', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 4, padding: '1px 6px' }}>
                    CSV import
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {!isManual && (
                  <>
                    <span style={{ fontSize: 12, color: '#888' }}>
                      Last sync: <strong>{formatSyncTime(item.last_synced_at)}</strong>
                    </span>
                    {syncResults[item.item_id] && (
                      <span style={{ fontSize: 11, color: syncResults[item.item_id].startsWith('Error') ? '#ef4444' : '#15803d' }}>
                        {syncResults[item.item_id]}
                      </span>
                    )}
                    <button
                      onClick={() => handleSyncItem(item.item_id)}
                      disabled={syncingItem === item.item_id}
                      style={{ fontSize: 11, color: '#6366f1', background: 'none', border: '1px solid #c7d2fe', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontWeight: 600 }}
                    >
                      {syncingItem === item.item_id ? 'Syncing…' : 'Sync'}
                    </button>
                  </>
                )}
                <button
                  onClick={() => setConfirmDelete(item.item_id)}
                  style={{ fontSize: 11, color: '#ef4444', background: 'none', border: '1px solid #fca5a5', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}
                >
                  Remove
                </button>
              </div>
            </div>

            {/* Account rows */}
            {item.accounts.map((acct) => (
              <div key={acct.account_id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 16px', borderBottom: '1px solid #f3f4f6',
              }}>
                <div style={{ flex: 1 }}>
                  {editing === acct.account_id ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveNickname(acct.account_id); if (e.key === 'Escape') cancelEdit() }}
                        autoFocus
                        style={{ padding: '4px 8px', border: '1px solid #6366f1', borderRadius: 5, fontSize: 13, width: 220 }}
                      />
                      <button
                        onClick={() => saveNickname(acct.account_id)}
                        disabled={saving}
                        style={{ padding: '4px 10px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 5, fontSize: 12, cursor: 'pointer' }}
                      >
                        Save
                      </button>
                      <button
                        onClick={cancelEdit}
                        style={{ padding: '4px 10px', background: '#f3f4f6', border: '1px solid #ddd', borderRadius: 5, fontSize: 12, cursor: 'pointer' }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: acct.nickname ? 600 : 400 }}>
                        {displayName(acct)}
                      </span>
                      {acct.mask && (
                        <span style={{ fontSize: 12, color: '#888' }}>••••{acct.mask}</span>
                      )}
                      {!acct.nickname && acct.official_name && acct.official_name !== acct.name && (
                        <span style={{ fontSize: 11, color: '#aaa' }}>({acct.name})</span>
                      )}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: '#bbb', textTransform: 'capitalize' }}>
                    {acct.subtype || acct.type}
                  </span>
                  {editing !== acct.account_id && (
                    <button
                      onClick={() => startEdit(acct)}
                      style={{ fontSize: 11, color: '#6366f1', background: 'none', border: '1px solid #c7d2fe', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}
                    >
                      Rename
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      })}

      {/* Delete confirmation */}
      {confirmDelete && (() => {
        const item = items.find(i => i.item_id === confirmDelete)
        return (
          <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
            <div className="modal" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
              <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Remove {item?.institution_name}?</h2>
              <p style={{ fontSize: 13, color: '#555', marginBottom: 20 }}>
                This removes the linked connection and its account records. Transactions already synced are kept.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setConfirmDelete(null)} style={{ flex: 1, padding: '8px 0', background: '#f3f4f6', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                  Cancel
                </button>
                <button onClick={() => handleDeleteItem(confirmDelete)} style={{ flex: 1, padding: '8px 0', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  Remove
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
