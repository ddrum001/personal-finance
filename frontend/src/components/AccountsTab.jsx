import { useState, useEffect } from 'react'
import { updateAccountNickname, deleteItem, syncItem, setAccountExcluded, getGmailStatus, getGmailConnectUrl, disconnectGmail, syncAmazonOrders } from '../api/client'
import PlaidLinkButton from './PlaidLink'
import PlaidReconnectButton from './PlaidReconnectButton'

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

export default function AccountsTab({ items, onRefresh, onImportCsv, onPlaidSuccess }) {
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [syncingItem, setSyncingItem] = useState(null)
  const [syncResults, setSyncResults] = useState({})
  const [gmailStatus, setGmailStatus] = useState(null)
  const [gmailConnecting, setGmailConnecting] = useState(false)
  const [gmailError, setGmailError] = useState('')
  const [amazonSyncing, setAmazonSyncing] = useState(false)
  const [amazonSyncResult, setAmazonSyncResult] = useState(null)

  // Load Gmail status + handle redirect-back from OAuth
  useEffect(() => {
    getGmailStatus().then(setGmailStatus).catch(() => setGmailStatus({ connected: false }))

    const params = new URLSearchParams(window.location.search)
    if (params.has('gmail')) {
      const val = params.get('gmail')
      if (val === 'connected') getGmailStatus().then(setGmailStatus)
      // Clean the URL
      const clean = window.location.pathname
      window.history.replaceState({}, '', clean)
    }
    if (params.has('gmail_error')) {
      setGmailError(`Gmail connection failed: ${params.get('gmail_error')}`)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  const handleGmailConnect = async () => {
    setGmailConnecting(true)
    setGmailError('')
    try {
      const { auth_url } = await getGmailConnectUrl()
      window.location.href = auth_url
    } catch (e) {
      setGmailError('Could not start Gmail connection.')
      setGmailConnecting(false)
    }
  }

  const handleGmailDisconnect = async () => {
    await disconnectGmail()
    setGmailStatus({ connected: false, gmail_address: null })
  }

  const handleAmazonSync = async () => {
    setAmazonSyncing(true)
    setAmazonSyncResult(null)
    try {
      const result = await syncAmazonOrders()
      setAmazonSyncResult(result)
    } catch (e) {
      let detail
      try { detail = JSON.parse(e.message).detail } catch { detail = e.message }
      if (detail === 'gmail_reauth_required') {
        // Refresh token revoked — backend already wiped the credential.
        // Drop back to disconnected state so the reconnect button appears.
        setGmailStatus({ connected: false, gmail_address: null })
        setGmailError('Gmail authorization expired — please reconnect to sync Amazon orders.')
      } else {
        setAmazonSyncResult({ error: detail })
      }
    } finally {
      setAmazonSyncing(false)
    }
  }

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
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button
          onClick={onImportCsv}
          style={{ padding: '7px 16px', background: '#fff', color: '#6366f1', border: '1px solid #6366f1', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
        >
          Import CSV
        </button>
        <PlaidLinkButton onSuccess={onPlaidSuccess} />
      </div>

      {/* Gmail Integration */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Gmail Integration</span>
            <span style={{ marginLeft: 8, fontSize: 11, color: '#888' }}>Auto-categorize Amazon orders</span>
          </div>
          {gmailStatus?.connected && (
            <span style={{ fontSize: 11, background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0', borderRadius: 10, padding: '2px 8px', fontWeight: 600 }}>
              Connected
            </span>
          )}
        </div>
        <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {gmailStatus === null ? (
            <span style={{ fontSize: 13, color: '#aaa' }}>Loading…</span>
          ) : gmailStatus.connected ? (
            <>
              <span style={{ fontSize: 13, color: '#555' }}>
                Connected as <strong>{gmailStatus.gmail_address || 'Gmail account'}</strong>
              </span>
              <button
                onClick={handleAmazonSync}
                disabled={amazonSyncing}
                style={{ padding: '5px 14px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, cursor: amazonSyncing ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 12, opacity: amazonSyncing ? 0.7 : 1 }}
              >
                {amazonSyncing ? 'Syncing…' : 'Sync Amazon Orders'}
              </button>
              <button
                onClick={handleGmailDisconnect}
                style={{ fontSize: 12, color: '#ef4444', background: 'none', border: '1px solid #fca5a5', borderRadius: 4, padding: '3px 10px', cursor: 'pointer' }}
              >
                Disconnect
              </button>
              {amazonSyncResult && !amazonSyncResult.error && (
                <span style={{ fontSize: 12, color: '#15803d' }}>
                  {amazonSyncResult.added} new order{amazonSyncResult.added !== 1 ? 's' : ''} found
                  {amazonSyncResult.skipped > 0 ? ` · ${amazonSyncResult.skipped} already synced` : ''}
                </span>
              )}
              {amazonSyncResult?.error && (
                <span style={{ fontSize: 12, color: '#ef4444' }}>{amazonSyncResult.error}</span>
              )}
            </>
          ) : (
            <>
              <span style={{ fontSize: 13, color: '#555' }}>
                Connect your Gmail account to pull Amazon order details for easier transaction categorization.
              </span>
              <button
                onClick={handleGmailConnect}
                disabled={gmailConnecting}
                style={{ padding: '7px 16px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, cursor: gmailConnecting ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 13, opacity: gmailConnecting ? 0.7 : 1, whiteSpace: 'nowrap' }}
              >
                {gmailConnecting ? 'Redirecting…' : 'Connect Gmail'}
              </button>
            </>
          )}
          {gmailError && <span style={{ fontSize: 12, color: '#ef4444' }}>{gmailError}</span>}
        </div>
      </div>

      {sorted.map((item) => {
        const isManual = item.is_manual
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
                    <PlaidReconnectButton itemId={item.item_id} onSuccess={onPlaidSuccess} />
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
                opacity: acct.is_excluded ? 0.5 : 1,
                background: acct.is_excluded ? '#f9fafb' : undefined,
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
                  {acct.is_excluded && (
                    <span style={{ fontSize: 11, color: '#888', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 4, padding: '1px 6px' }}>
                      excluded
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: '#bbb', textTransform: 'capitalize' }}>
                    {acct.subtype || acct.type}
                  </span>
                  {editing !== acct.account_id && (
                    <>
                      <button
                        onClick={() => startEdit(acct)}
                        style={{ fontSize: 11, color: '#6366f1', background: 'none', border: '1px solid #c7d2fe', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}
                      >
                        Rename
                      </button>
                      {!isManual && (
                        <button
                          onClick={async () => { await setAccountExcluded(acct.account_id, !acct.is_excluded); await onRefresh() }}
                          title={acct.is_excluded ? 'Re-include in sync' : 'Exclude from sync (joint account)'}
                          style={{ fontSize: 11, background: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
                            color: acct.is_excluded ? '#888' : '#f59e0b',
                            border: acct.is_excluded ? '1px solid #e5e7eb' : '1px solid #fde68a',
                          }}
                        >
                          {acct.is_excluded ? 'Re-include' : 'Exclude'}
                        </button>
                      )}
                    </>
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
