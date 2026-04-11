import { useState, useEffect, useCallback } from 'react'
import {
  getCreditCards, refreshLiabilities, refreshCardLiabilities,
  checkSchedulePayment, confirmSchedulePayment,
  createPromoBalance, updatePromoBalance, deletePromoBalance,
  planPromoPayments,
} from '../api/client'

const fmt = (n) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const fmtDate = (d) => {
  if (!d) return '—'
  const [y, m, day] = String(d).split('-')
  return `${parseInt(m)}/${parseInt(day)}/${y}`
}

const STATUS_STYLE = {
  paid:        { background: '#f0fdf4', color: '#15803d', label: 'Paid' },
  overdue:     { background: '#fef2f2', color: '#dc2626', label: 'Overdue' },
  due_soon:    { background: '#fef9c3', color: '#854d0e', label: 'Due soon' },
  upcoming:    { background: '#f0fdf4', color: '#15803d', label: 'Upcoming' },
  no_due_date: { background: '#fef9c3', color: '#854d0e', label: 'No due date' },
  unknown:     { background: '#f3f4f6', color: '#6b7280', label: 'No data' },
}

// ---------------------------------------------------------------------------
// Promo balance modal (add / edit)
// ---------------------------------------------------------------------------
function PromoModal({ promo, defaultAccountId, cards, onClose, onSave }) {
  const [accountId, setAccountId] = useState(promo?.account_id ?? defaultAccountId ?? cards[0]?.account_id ?? '')
  const [description, setDescription] = useState(promo?.description ?? '')
  const [amount, setAmount] = useState(promo ? String(promo.current_amount) : '')
  const [endDate, setEndDate] = useState(promo?.promo_end_date ?? '')
  const [promoType, setPromoType] = useState(promo?.promo_type ?? 'balance_transfer')
  const [notes, setNotes] = useState(promo?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const handleSave = async () => {
    if (!accountId || !description.trim() || !amount || !endDate) return
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt < 0) { setError('Amount must be a positive number'); return }
    setSaving(true); setError(null)
    try {
      await onSave({ account_id: accountId, description: description.trim(), current_amount: amt, promo_end_date: endDate, promo_type: promoType, notes: notes.trim() || null })
      onClose()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }
  const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6 }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{promo ? 'Edit Promo Balance' : 'Add Promo Balance'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>×</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>Card</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={inputStyle}>
              {cards.map((c) => <option key={c.account_id} value={c.account_id}>{c.name}{c.mask ? ` ····${c.mask}` : ''}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Home Depot purchase" style={inputStyle} autoFocus />
          </div>
          <div>
            <label style={labelStyle}>Promo type</label>
            <div style={{ display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
              {[
                { value: 'balance_transfer', label: 'Balance Transfer' },
                { value: 'purchases', label: 'All Purchases' },
              ].map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPromoType(value)}
                  style={{
                    flex: 1, padding: '8px 0', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
                    background: promoType === value ? '#6366f1' : '#fff',
                    color: promoType === value ? '#fff' : '#555',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {promoType === 'balance_transfer' && (
              <div style={{ marginTop: 6, fontSize: 12, color: '#d97706', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 5, padding: '5px 8px' }}>
                New purchases on this card accrue interest at the regular rate.
              </div>
            )}
          </div>
          <div>
            <label style={labelStyle}>Remaining balance</label>
            <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Promo end date (0% expires)</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Notes <span style={{ color: '#aaa', fontWeight: 400 }}>(optional)</span></label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" style={inputStyle} />
          </div>
          {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: 10, fontSize: 13, color: '#991b1b' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ flex: 1, padding: '9px 0', background: '#f3f4f6', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
            <button onClick={handleSave} disabled={saving || !accountId || !description.trim() || !amount || !endDate}
              style={{ flex: 2, padding: '9px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14, background: '#6366f1', color: '#fff' }}>
              {saving ? 'Saving…' : promo ? 'Save changes' : 'Add promo'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Plan payments modal
// ---------------------------------------------------------------------------
function PlanPaymentsModal({ promo, cardName, onClose, onPlanned }) {
  const today = new Date()
  const endDate = new Date(promo.promo_end_date)
  const monthsLeft = Math.max(1, Math.ceil((endDate - today) / (1000 * 60 * 60 * 24 * 30)))
  const defaultStart = new Date(today.getFullYear(), today.getMonth() + 1, 1).toISOString().split('T')[0]

  const [numPayments, setNumPayments] = useState(String(monthsLeft))
  const [startDate, setStartDate] = useState(defaultStart)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const n = parseInt(numPayments) || 1
  const perPayment = n > 0 ? (promo.current_amount / n).toFixed(2) : '0.00'

  const handlePlan = async () => {
    setSaving(true); setError(null)
    try {
      const result = await planPromoPayments(promo.id, n, startDate)
      onPlanned(result.created)
      onClose()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }
  const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6 }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Plan Promo Payments</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>×</button>
        </div>
        <div style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
          <div style={{ fontWeight: 600 }}>{cardName} — {promo.description}</div>
          <div style={{ color: '#888', marginTop: 2 }}>
            {fmt(promo.current_amount)} remaining · promo ends {fmtDate(promo.promo_end_date)}
            {promo.days_remaining <= 60 && (
              <span style={{ color: '#dc2626', fontWeight: 600, marginLeft: 6 }}>({promo.days_remaining} days left)</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>Number of monthly payments</label>
            <input type="number" min="1" max="36" value={numPayments} onChange={(e) => setNumPayments(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>First payment date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ background: '#ede9fe', borderRadius: 6, padding: '8px 12px', fontSize: 13 }}>
            <strong>{fmt(parseFloat(perPayment))}/month</strong> for {n} payment{n !== 1 ? 's' : ''}
            {n > 1 && <span style={{ color: '#7c3aed' }}> (last payment adjusted for rounding)</span>}
          </div>
          {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: 10, fontSize: 13, color: '#991b1b' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ flex: 1, padding: '9px 0', background: '#f3f4f6', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
            <button onClick={handlePlan} disabled={saving || n < 1}
              style={{ flex: 2, padding: '9px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14, background: '#6366f1', color: '#fff' }}>
              {saving ? 'Creating…' : `Create ${n} payment${n !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Conflict modal for schedule-payment duplicate
// ---------------------------------------------------------------------------
function ScheduleConflictModal({ proposed, existing, onReplace, onAdd, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Payment already scheduled</h2>
        <p style={{ fontSize: 13, color: '#555', marginBottom: 12 }}>
          There's already a cashflow entry for this card:
        </p>
        <div style={{ background: '#fef9c3', borderRadius: 6, padding: '8px 12px', fontSize: 13, marginBottom: 12 }}>
          <strong>{existing.name}</strong> · {fmt(existing.amount)} · {fmtDate(existing.date)}
        </div>
        <p style={{ fontSize: 13, color: '#555', marginBottom: 16 }}>
          New payment: <strong>{fmt(proposed.amount)}</strong> due <strong>{fmtDate(proposed.date)}</strong>
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={onReplace} style={{ padding: '9px 0', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
            Replace existing entry
          </button>
          <button onClick={onAdd} style={{ padding: '9px 0', background: '#fff', color: '#6366f1', border: '1px solid #6366f1', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            Add as a second payment
          </button>
          <button onClick={onClose} style={{ padding: '9px 0', background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 13 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------
export default function CreditCardsTab() {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshingCard, setRefreshingCard] = useState(null) // account_id being refreshed
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)

  // Modals
  const [promoModal, setPromoModal] = useState(null)   // null | 'add' | promo-object
  const [planModal, setPlanModal] = useState(null)     // null | {promo, cardName}
  const [conflictModal, setConflictModal] = useState(null)  // null | {proposed, existing, accountId}

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setCards(await getCreditCards()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleRefresh = async () => {
    setRefreshing(true); setError(null)
    try {
      const result = await refreshLiabilities()
      if (result.errors?.length) setError(result.errors.join(' | '))
      await load()
    }
    catch (e) { setError(e.message) }
    finally { setRefreshing(false) }
  }

  const handleRefreshCard = async (accountId) => {
    setRefreshingCard(accountId); setError(null)
    try {
      const result = await refreshCardLiabilities(accountId)
      if (result.errors?.length) setError(result.errors.join(' | '))
      else showToast('Updated')
      await load()
    }
    catch (e) { setError(e.message) }
    finally { setRefreshingCard(null) }
  }

  const handleSchedulePayment = async (accountId) => {
    try {
      const result = await checkSchedulePayment(accountId)
      if (result.existing) {
        setConflictModal({ proposed: result.proposed, existing: result.existing, accountId })
      } else {
        await confirmSchedulePayment(accountId, 'add')
        showToast('Payment scheduled in Cashflow')
      }
    } catch (e) { setError(e.message) }
  }

  const handleConflictReplace = async () => {
    const { accountId, existing } = conflictModal
    setConflictModal(null)
    try {
      await confirmSchedulePayment(accountId, 'replace', existing.id)
      showToast('Payment updated in Cashflow')
    } catch (e) { setError(e.message) }
  }

  const handleConflictAdd = async () => {
    const { accountId } = conflictModal
    setConflictModal(null)
    try {
      await confirmSchedulePayment(accountId, 'add')
      showToast('Second payment scheduled in Cashflow')
    } catch (e) { setError(e.message) }
  }

  const handleSavePromo = async (body) => {
    if (promoModal && promoModal !== 'add' && !promoModal._addForCard) {
      await updatePromoBalance(promoModal.id, body)
    } else {
      await createPromoBalance(body)
    }
    await load()
  }

  const handleDeletePromo = async (id) => {
    if (!confirm('Delete this promo balance?')) return
    try { await deletePromoBalance(id); await load() }
    catch (e) { setError(e.message) }
  }

  return (
    <div>
      {promoModal !== null && (
        <PromoModal
          promo={(promoModal === 'add' || promoModal?._addForCard) ? null : promoModal}
          defaultAccountId={promoModal?._addForCard ?? null}
          cards={cards}
          onClose={() => setPromoModal(null)}
          onSave={handleSavePromo}
        />
      )}
      {planModal && (
        <PlanPaymentsModal
          promo={planModal.promo}
          cardName={planModal.cardName}
          onClose={() => setPlanModal(null)}
          onPlanned={(n) => { showToast(`${n} payments added to Cashflow`); load() }}
        />
      )}
      {conflictModal && (
        <ScheduleConflictModal
          proposed={conflictModal.proposed}
          existing={conflictModal.existing}
          onReplace={handleConflictReplace}
          onAdd={handleConflictAdd}
          onClose={() => setConflictModal(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#111', color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 9999 }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Credit Cards</h2>
          <div style={{ fontSize: 12, color: '#888', marginTop: 3 }}>Statement balances · payment tracking · promo payoff planning</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{ padding: '7px 14px', background: '#fff', border: '1px solid #6366f1', color: '#6366f1', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
          >
            {refreshing ? 'Refreshing…' : 'Refresh Liabilities'}
          </button>
          <button
            onClick={() => setPromoModal('add')}
            style={{ padding: '7px 14px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
          >
            + Add Promo
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 12, fontSize: 13, color: '#991b1b', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#888', fontSize: 14 }}>Loading…</div>
      ) : (
        <>
          {/* ── Cards ── */}
          <div style={{ display: 'grid', gap: 12, marginBottom: 32 }}>
            {cards.map((card) => {
              const util = card.credit_limit && card.balance != null
                ? Math.round((card.balance / card.credit_limit) * 100)
                : null
              const st = STATUS_STYLE[card.status] || STATUS_STYLE.unknown
              const hasStatement = card.statement_balance != null

              return (
                <div key={card.account_id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '14px 16px', background: '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    {/* Left: card info */}
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>
                        {card.name}{card.mask ? <span style={{ color: '#aaa', fontWeight: 400, fontSize: 13 }}> ····{card.mask}</span> : ''}
                      </div>

                      {/* Balance + limit + utilization bar */}
                      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, color: '#555' }}>
                          Balance: <strong style={{ color: '#111' }}>{fmt(card.balance)}</strong>
                        </span>
                        {card.credit_limit && (
                          <span style={{ fontSize: 13, color: '#555' }}>
                            Limit: <strong>{fmt(card.credit_limit)}</strong>
                          </span>
                        )}
                        {util != null && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 80, height: 6, background: '#f3f4f6', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ width: `${Math.min(util, 100)}%`, height: '100%', background: util > 80 ? '#ef4444' : util > 50 ? '#f59e0b' : '#10b981', borderRadius: 3 }} />
                            </div>
                            <span style={{ fontSize: 11, color: util > 80 ? '#ef4444' : '#888' }}>{util}%</span>
                          </div>
                        )}
                      </div>

                      {/* Statement row */}
                      <div style={{ marginTop: 8, fontSize: 13 }}>
                        {hasStatement ? (
                          <span>
                            Statement: <strong>{fmt(card.statement_balance)}</strong>
                            {card.statement_due_date && <span>{' · '}Due: <strong>{fmtDate(card.statement_due_date)}</strong></span>}
                            {card.minimum_payment != null && (
                              <span style={{ color: '#888' }}> · Min: {fmt(card.minimum_payment)}</span>
                            )}
                          </span>
                        ) : (
                          <span style={{ color: '#aaa', fontStyle: 'italic' }}>No statement data — click refresh</span>
                        )}
                      </div>
                    </div>

                    {/* Right: status + actions */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ background: st.background, color: st.color, padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600 }}>
                          {st.label}
                        </span>
                        <button
                          onClick={() => handleRefreshCard(card.account_id)}
                          disabled={refreshingCard === card.account_id}
                          title="Refresh this card's liabilities"
                          style={{ padding: '3px 8px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: '#6366f1' }}
                        >
                          {refreshingCard === card.account_id ? '…' : '↻'}
                        </button>
                      </div>
                      {hasStatement && (
                        <button
                          onClick={() => handleSchedulePayment(card.account_id)}
                          style={{ padding: '5px 12px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                        >
                          Schedule Payment
                        </button>
                      )}
                      {card.liabilities_updated_at && (
                        <span style={{ fontSize: 11, color: '#bbb' }}>
                          Updated {new Date(card.liabilities_updated_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ── Promo balances for this card ── */}
                  <div style={{ marginTop: 12, borderTop: '1px solid #f3f4f6', paddingTop: 10 }}>
                    {card.promos.length > 0 && (
                      <div style={{ display: 'grid', gap: 8, marginBottom: 8 }}>
                        {card.promos.map((promo) => {
                          const urgent = promo.days_remaining <= 60
                          const critical = promo.days_remaining <= 14
                          return (
                            <div key={promo.id} style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              flexWrap: 'wrap', gap: 8,
                              background: critical ? '#fef2f2' : urgent ? '#fffbeb' : '#f9fafb',
                              border: `1px solid ${critical ? '#fecaca' : urgent ? '#fde68a' : '#e5e7eb'}`,
                              borderRadius: 8, padding: '8px 12px',
                            }}>
                              <div style={{ flex: 1, minWidth: 180 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <span style={{ fontWeight: 600, fontSize: 13 }}>{promo.description}</span>
                                  <span style={{
                                    fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.03em',
                                    background: promo.promo_type === 'purchases' ? '#ede9fe' : '#fef3c7',
                                    color: promo.promo_type === 'purchases' ? '#6d28d9' : '#92400e',
                                  }}>
                                    {promo.promo_type === 'purchases' ? 'All Purchases' : 'Balance Transfer'}
                                  </span>
                                </div>
                                <div style={{ marginTop: 3, fontSize: 12, color: '#555' }}>
                                  <span style={{ fontWeight: 600, color: '#111' }}>{fmt(promo.current_amount)}</span>
                                  {' remaining · 0% expires '}
                                  <strong style={{ color: critical ? '#dc2626' : urgent ? '#d97706' : '#374151' }}>
                                    {fmtDate(promo.promo_end_date)}
                                  </strong>
                                  <span style={{ marginLeft: 6, fontWeight: 600, color: critical ? '#dc2626' : urgent ? '#d97706' : '#9ca3af' }}>
                                    ({promo.days_remaining}d)
                                  </span>
                                </div>
                                {promo.promo_type === 'balance_transfer' && (
                                  <div style={{ marginTop: 3, fontSize: 11, color: '#b45309' }}>
                                    ⚠ New purchases on this card are NOT covered — they accrue interest immediately.
                                  </div>
                                )}
                                {promo.notes && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{promo.notes}</div>}
                              </div>
                              <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                                <button
                                  onClick={() => setPlanModal({ promo, cardName: card.name })}
                                  style={{ padding: '3px 10px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
                                >
                                  Plan
                                </button>
                                <button
                                  onClick={() => setPromoModal({ ...promo, account_id: card.account_id })}
                                  style={{ padding: '3px 8px', background: 'none', border: '1px solid #e5e7eb', borderRadius: 5, cursor: 'pointer', fontSize: 11, color: '#555' }}
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleDeletePromo(promo.id)}
                                  style={{ padding: '3px 8px', background: 'none', border: '1px solid #fecaca', borderRadius: 5, cursor: 'pointer', fontSize: 11, color: '#ef4444' }}
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    <button
                      onClick={() => setPromoModal({ _addForCard: card.account_id })}
                      style={{ fontSize: 11, color: '#6366f1', background: 'none', border: '1px dashed #c7d2fe', borderRadius: 5, padding: '3px 10px', cursor: 'pointer' }}
                    >
                      + Add Promo
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
