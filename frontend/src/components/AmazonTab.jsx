import { useState, useEffect } from 'react'
import { getAmazonOrders, getAmazonOrderCandidates, linkAmazonOrder, unlinkAmazonOrder, dismissAmazonOrder, restoreAmazonOrder, automatchAmazonOrders, reparseAmazonOrders } from '../api/client'

function OrderCard({ order, onLink, onUnlink, onDismiss, onRestore }) {
  const sub = order.subtotals || {}
  const hasSubtotals = sub.item_subtotal != null || sub.shipping != null || sub.tax != null

  return (
    <div style={{ padding: '14px 16px', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Date + order number */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>
              {order.order_date || '—'}
            </span>
            <span style={{ fontSize: 11, color: '#bbb', fontFamily: 'monospace' }}>
              #{order.order_id}
            </span>
            {order.gmail_message_id && (
              <a
                href={`https://mail.google.com/mail/u/0/#all/${order.gmail_message_id}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 11, color: '#6366f1', textDecoration: 'none' }}
              >
                view email ↗
              </a>
            )}
          </div>

          {/* Grand Total + subtotals */}
          {order.order_total != null && (
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>
                ${order.order_total.toFixed(2)}
              </span>
              {hasSubtotals && (
                <span style={{ fontSize: 11, color: '#888', marginLeft: 10 }}>
                  {sub.item_subtotal != null && `items $${sub.item_subtotal.toFixed(2)}`}
                  {sub.shipping != null && ` · shipping $${sub.shipping.toFixed(2)}`}
                  {sub.tax != null && ` · tax $${sub.tax.toFixed(2)}`}
                </span>
              )}
            </div>
          )}

          {/* Items */}
          {order.items?.length > 0 && (
            <div style={{ fontSize: 12, color: '#666' }}>
              {order.items.slice(0, 3).map((item, i) => (
                <div key={i} style={{ marginBottom: 1 }}>· {item.description}</div>
              ))}
              {order.items.length > 3 && (
                <div style={{ color: '#aaa' }}>+ {order.items.length - 3} more</div>
              )}
            </div>
          )}

          {/* Linked transaction */}
          {order.transaction && (
            <div style={{ marginTop: 6, fontSize: 12, color: '#15803d', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Linked: {order.transaction.name} · {order.transaction.date} · ${order.transaction.amount.toFixed(2)}</span>
              <button
                onClick={() => onUnlink(order)}
                style={{ fontSize: 11, color: '#ef4444', background: 'none', border: '1px solid #fca5a5', borderRadius: 4, padding: '1px 7px', cursor: 'pointer' }}
              >
                Unlink
              </button>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
          {!order.transaction && !order.dismissed && (
            <button onClick={() => onLink(order)} style={{ fontSize: 11, color: '#6366f1', background: 'none', border: '1px solid #c7d2fe', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>
              Link Transaction
            </button>
          )}
          {!order.transaction && !order.dismissed && onDismiss && (
            <button onClick={() => onDismiss(order)} style={{ fontSize: 11, color: '#9ca3af', background: 'none', border: '1px solid #e5e7eb', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              Dismiss
            </button>
          )}
          {order.dismissed && onRestore && (
            <button onClick={() => onRestore(order)} style={{ fontSize: 11, color: '#6b7280', background: 'none', border: '1px solid #e5e7eb', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              Restore
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function LinkModal({ order, onClose, onLinked }) {
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(true)
  const [linking, setLinking] = useState(null)

  useEffect(() => {
    getAmazonOrderCandidates(order.id)
      .then(setCandidates)
      .finally(() => setLoading(false))
  }, [order.id])

  const handleLink = async (transactionId) => {
    setLinking(transactionId)
    try {
      await linkAmazonOrder(order.id, transactionId)
      onLinked(order.id, transactionId)
      onClose()
    } finally {
      setLinking(null)
    }
  }

  const sub = order.subtotals || {}
  const hasSubtotals = sub.item_subtotal != null || sub.shipping != null || sub.tax != null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        {/* Order summary */}
        <div style={{ marginBottom: 14 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Link Transaction</h2>
          <div style={{ fontSize: 13, color: '#555', marginBottom: 2 }}>
            <span style={{ fontWeight: 700, fontSize: 16, color: '#111' }}>
              {order.order_total != null ? `$${order.order_total.toFixed(2)}` : '—'}
            </span>
            <span style={{ marginLeft: 10, color: '#888', fontSize: 12 }}>{order.order_date}</span>
          </div>
          {hasSubtotals && (
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
              {sub.item_subtotal != null && `items $${sub.item_subtotal.toFixed(2)}`}
              {sub.shipping != null && ` · shipping $${sub.shipping.toFixed(2)}`}
              {sub.tax != null && ` · tax $${sub.tax.toFixed(2)}`}
            </div>
          )}
          {order.items?.length > 0 && (
            <div style={{ fontSize: 11, color: '#888' }}>
              {order.items.slice(0, 2).map((item, i) => (
                <span key={i}>{i > 0 ? ' · ' : ''}{item.description}</span>
              ))}
              {order.items.length > 2 && <span> · +{order.items.length - 2} more</span>}
            </div>
          )}
        </div>

        <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
          Amazon transactions within 14 days, sorted by closest amount:
        </div>

        <div style={{ overflowY: 'auto', flex: 1, border: '1px solid #e5e7eb', borderRadius: 6 }}>
          {loading ? (
            <div style={{ padding: 16, textAlign: 'center', color: '#aaa', fontSize: 13 }}>Loading…</div>
          ) : candidates.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: '#aaa', fontSize: 13 }}>
              No Amazon transactions found within 14 days of this order.
            </div>
          ) : (
            candidates.map(txn => {
              const diff = txn.amount_diff
              const diffColor = diff == null ? '#aaa' : diff < 1 ? '#15803d' : diff < 10 ? '#b45309' : '#9ca3af'
              return (
                <div key={txn.transaction_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: '1px solid #f3f4f6' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {txn.merchant_name || txn.name}
                    </div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{txn.date}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>${txn.amount.toFixed(2)}</div>
                    {diff != null && (
                      <div style={{ fontSize: 11, color: diffColor }}>
                        {diff < 0.01 ? 'exact' : `Δ $${diff.toFixed(2)}`}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleLink(txn.transaction_id)}
                    disabled={linking === txn.transaction_id}
                    style={{ padding: '4px 12px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 600, flexShrink: 0, opacity: linking === txn.transaction_id ? 0.6 : 1 }}
                  >
                    {linking === txn.transaction_id ? '…' : 'Link'}
                  </button>
                </div>
              )
            })
          )}
        </div>

        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '7px 18px', background: '#f3f4f6', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AmazonTab() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [linkingOrder, setLinkingOrder] = useState(null)
  const [showLinked, setShowLinked] = useState(false)
  const [showDismissed, setShowDismissed] = useState(false)
  const [autoMatching, setAutoMatching] = useState(false)
  const [autoMatchResult, setAutoMatchResult] = useState(null)
  const [reparsing, setReparsing] = useState(false)
  const [reparseResult, setReparseResult] = useState(null)

  useEffect(() => {
    getAmazonOrders()
      .then(setOrders)
      .finally(() => setLoading(false))
  }, [])

  const unlinked = orders.filter(o => !o.transaction && !o.dismissed)
  const linked = orders.filter(o => o.transaction)
  const dismissed = orders.filter(o => o.dismissed && !o.transaction)

  const handleLinked = (orderId, transactionId) => {
    // Optimistically mark the order as linked (we don't have full txn data here,
    // so just reload to get the updated transaction details)
    getAmazonOrders().then(setOrders)
  }

  const handleAutoMatch = async () => {
    setAutoMatching(true)
    setAutoMatchResult(null)
    try {
      const result = await automatchAmazonOrders()
      setAutoMatchResult(result)
      const refreshed = await getAmazonOrders()
      setOrders(refreshed)
    } catch (e) {
      setAutoMatchResult({ error: e.message })
    } finally {
      setAutoMatching(false)
    }
  }

  const handleReparse = async (onlyMissing = true) => {
    setReparsing(true)
    setReparseResult(null)
    let totalUpdated = 0, totalFailed = 0, prevRemaining = Infinity, totalProcessed = 0
    try {
      while (true) {
        const result = await reparseAmazonOrders({ onlyMissing })
        totalUpdated += result.updated
        totalFailed += result.failed
        totalProcessed += result.processed
        setReparseResult({ updated: totalUpdated, failed: totalFailed, remaining: result.remaining })
        // For force-reparse, stop when we've processed fewer than a full batch (done)
        // For missing-only, stop when remaining stops decreasing
        if (result.processed === 0) break
        if (onlyMissing && result.remaining >= prevRemaining) break
        if (!onlyMissing && result.processed < 30) break
        prevRemaining = result.remaining
      }
      const refreshed = await getAmazonOrders()
      setOrders(refreshed)
    } catch (e) {
      setReparseResult(prev => ({ ...(prev || {}), error: e.message }))
    } finally {
      setReparsing(false)
    }
  }

  const handleUnlink = async (order) => {
    await unlinkAmazonOrder(order.id)
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, transaction: null, match_type: null } : o))
  }

  const handleDismiss = async (order) => {
    await dismissAmazonOrder(order.id)
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, dismissed: true } : o))
  }

  const handleRestore = async (order) => {
    await restoreAmazonOrder(order.id)
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, dismissed: false } : o))
  }

  if (loading) {
    return <div style={{ padding: 32, textAlign: 'center', color: '#aaa' }}>Loading…</div>
  }

  if (orders.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: '#aaa', fontSize: 14 }}>
        No Amazon orders synced yet. Use the Gmail Integration on the Accounts tab to sync.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          onClick={handleAutoMatch}
          disabled={autoMatching}
          style={{ padding: '6px 14px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, cursor: autoMatching ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 12, opacity: autoMatching ? 0.7 : 1 }}
        >
          {autoMatching ? 'Matching…' : 'Auto-link Exact Matches'}
        </button>
        {autoMatchResult && !autoMatchResult.error && (
          <span style={{ fontSize: 12, color: '#15803d' }}>
            {autoMatchResult.linked} linked of {autoMatchResult.checked} checked
          </span>
        )}
        {autoMatchResult?.error && (
          <span style={{ fontSize: 12, color: '#ef4444' }}>{autoMatchResult.error}</span>
        )}
      </div>

      {/* Reparse toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          onClick={() => handleReparse(true)}
          disabled={reparsing}
          style={{ padding: '6px 14px', background: '#fff', color: '#6366f1', border: '1px solid #c7d2fe', borderRadius: 6, cursor: reparsing ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 12, opacity: reparsing ? 0.7 : 1 }}
        >
          {reparsing ? 'Reparsing…' : 'Reparse Missing'}
        </button>
        <button
          onClick={() => handleReparse(false)}
          disabled={reparsing}
          style={{ padding: '6px 14px', background: '#fff', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: 6, cursor: reparsing ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 12, opacity: reparsing ? 0.7 : 1 }}
          title="Re-fetches all emails — use to apply parser fixes to already-parsed orders"
        >
          {reparsing ? 'Reparsing…' : 'Reparse All'}
        </button>
        {reparseResult && !reparseResult.error && (
          <span style={{ fontSize: 12, color: reparsing ? '#6366f1' : '#15803d' }}>
            {reparseResult.updated} updated · {reparseResult.failed} failed
            {reparsing && reparseResult.remaining > 0
              ? ` · ${reparseResult.remaining} remaining…`
              : reparseResult.remaining > 0
              ? ` · ${reparseResult.remaining} couldn't be parsed`
              : ' · done'}
          </span>
        )}
        {reparseResult?.error && (
          <span style={{ fontSize: 12, color: '#ef4444' }}>{reparseResult.error}</span>
        )}
      </div>

      {/* Unmatched */}
      {unlinked.length > 0 && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', background: '#fffbeb', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Unmatched Orders</span>
            <span style={{ fontSize: 12, color: '#92400e' }}>
              {unlinked.length} order{unlinked.length !== 1 ? 's' : ''} need linking
            </span>
          </div>
          {unlinked.map(order => (
            <OrderCard key={order.id} order={order} onLink={setLinkingOrder} onUnlink={handleUnlink} onDismiss={handleDismiss} />
          ))}
        </div>
      )}

      {/* Matched */}
      {linked.length > 0 && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
          <div
            style={{ padding: '12px 16px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
            onClick={() => setShowLinked(s => !s)}
          >
            <span style={{ fontWeight: 700, fontSize: 14 }}>Matched Orders</span>
            <span style={{ fontSize: 12, color: '#888' }}>{linked.length} linked</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#aaa' }}>{showLinked ? '▲ hide' : '▼ show'}</span>
          </div>
          {showLinked && linked.map(order => (
            <OrderCard key={order.id} order={order} onLink={setLinkingOrder} onUnlink={handleUnlink} onDismiss={handleDismiss} />
          ))}
        </div>
      )}

      {unlinked.length === 0 && dismissed.length === 0 && (
        <div style={{ textAlign: 'center', color: '#15803d', fontSize: 13, padding: '8px 0' }}>
          All orders are linked.
        </div>
      )}

      {/* Dismissed */}
      {dismissed.length > 0 && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
          <div
            style={{ padding: '12px 16px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
            onClick={() => setShowDismissed(s => !s)}
          >
            <span style={{ fontWeight: 700, fontSize: 14, color: '#9ca3af' }}>Dismissed</span>
            <span style={{ fontSize: 12, color: '#bbb' }}>{dismissed.length} order{dismissed.length !== 1 ? 's' : ''}</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#bbb' }}>{showDismissed ? '▲ hide' : '▼ show'}</span>
          </div>
          {showDismissed && dismissed.map(order => (
            <OrderCard key={order.id} order={order} onLink={setLinkingOrder} onUnlink={handleUnlink} onRestore={handleRestore} />
          ))}
        </div>
      )}

      {linkingOrder && (
        <LinkModal
          order={linkingOrder}
          onClose={() => setLinkingOrder(null)}
          onLinked={handleLinked}
        />
      )}
    </div>
  )
}
