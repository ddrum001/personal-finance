import { useState, useEffect, useCallback } from 'react'
import PlaidLinkButton from './components/PlaidLink'
import SpendingByCategory from './components/SpendingByCategory'
import MonthlyTrend from './components/MonthlyTrend'
import TransactionList from './components/TransactionList'
import DateFilter, { getDateRange, getFilterLabel } from './components/DateFilter'
import { getTransactions, listItems, syncTransactions, getCategories } from './api/client'
import CategoriesTab from './components/CategoriesTab'
import CashflowTab from './components/CashflowTab'
import CreditCardsTab from './components/CreditCardsTab'
import ImportCsvModal from './components/ImportCsvModal'
import AccountsTab from './components/AccountsTab'
import AmazonTab from './components/AmazonTab'
import DuplicatesView from './components/DuplicatesView'
import Login from './components/Login'
import HelpModal from './components/HelpModal'

const now = new Date()

const DEFAULT_FILTER = {
  mode: 'last90',
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  quarter: Math.ceil((now.getMonth() + 1) / 3),
}

export default function App() {
  const [user, setUser] = useState(undefined) // undefined = loading, null = not authed
  const [tab, setTab] = useState(() => localStorage.getItem('activeTab') || 'dashboard')

  const switchTab = (t) => { setTab(t); localStorage.setItem('activeTab', t) }
  const [transactions, setTransactions] = useState([])
  const [items, setItems] = useState([])
  const [categories, setCategories] = useState([])
  const [syncing, setSyncing] = useState(false)
  const [filter, setFilter] = useState(DEFAULT_FILTER)
  const [importing, setImporting] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [reviewMode, setReviewMode] = useState(false)
  const [splitQueueMode, setSplitQueueMode] = useState(false)
  const [duplicatesMode, setDuplicatesMode] = useState(false)
  const [txnOffset, setTxnOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const PAGE_SIZE = 500

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(data => setUser(data))
      .catch(() => setUser(null))
  }, [])

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
  }

  const refreshUser = () =>
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(setUser)
      .catch(() => setUser(null))

  const { startDate, endDate } = getDateRange(filter)

  const loadData = useCallback(async () => {
    if (!user) return
    const params = reviewMode
      ? { needsReview: true, limit: 2000 }
      : splitQueueMode
      ? { needsSplits: true }
      : { startDate, endDate, limit: PAGE_SIZE, offset: 0 }
    const [txns, linkedItems] = await Promise.all([
      getTransactions(params),
      listItems(),
    ])
    setTransactions(txns)
    setItems(linkedItems)
    setTxnOffset(0)
    setHasMore(!reviewMode && !splitQueueMode && txns.length === PAGE_SIZE)
  }, [user, startDate, endDate, reviewMode, splitQueueMode])

  const loadMore = useCallback(async () => {
    const nextOffset = txnOffset + PAGE_SIZE
    const more = await getTransactions({ startDate, endDate, limit: PAGE_SIZE, offset: nextOffset })
    setTransactions(prev => [...prev, ...more])
    setTxnOffset(nextOffset)
    setHasMore(more.length === PAGE_SIZE)
  }, [startDate, endDate, txnOffset])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { if (user) getCategories().then(setCategories).catch(console.error) }, [user])

  const handleSync = async () => {
    setSyncing(true)
    try { await syncTransactions() } catch {}
    await loadData()
    setSyncing(false)
  }

  if (user === undefined) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#888', fontSize: 14 }}>
      Loading…
    </div>
  )
  if (!user) return <Login onSuccess={refreshUser} />

  return (
    <div className="app-container">
      {importing && (
        <ImportCsvModal
          onClose={() => setImporting(false)}
          onImported={loadData}
        />
      )}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      <header className="app-header">
        <h1>Personal Finance</h1>
        <div className="app-header-actions">
          <button
            onClick={() => setHelpOpen(true)}
            style={{ padding: '8px 12px', background: '#fff', color: '#6366f1', border: '1px solid #6366f1', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 14 }}
            title="Help"
          >?</button>
          <button
            onClick={handleLogout}
            style={{ padding: '8px 16px', background: '#fff', color: '#888', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
          >
            Sign out
          </button>
          {items.length > 0 && (
            <button onClick={handleSync} disabled={syncing} style={{ padding: '8px 16px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
              {syncing ? 'Syncing…' : 'Sync All'}
            </button>
          )}
        </div>
      </header>


      {(() => {
        const NAV_GROUPS = [
          { group: 'Planning', tabs: ['dashboard', 'cashflow'] },
          { group: 'Tracking', tabs: ['transactions', 'amazon'] },
          { group: 'Setup',    tabs: ['accounts', 'credit cards', 'categories'] },
        ]
        const activeGroup = NAV_GROUPS.find(g => g.tabs.includes(tab))
        return (
          <>
            <nav className="nav-tabs">
              {NAV_GROUPS.map(({ group, tabs }) => {
                const isActive = activeGroup?.group === group
                return (
                  <button
                    key={group}
                    className="nav-tab"
                    onClick={() => { if (!isActive) switchTab(tabs[0]) }}
                    style={{
                      color: isActive ? '#6366f1' : '#555',
                      borderBottom: isActive ? '2px solid #6366f1' : '2px solid transparent',
                    }}
                  >
                    {group}
                  </button>
                )
              })}
            </nav>
            {activeGroup && (
              <div className="sub-tabs">
                {activeGroup.tabs.map((t) => (
                  <button
                    key={t}
                    className="sub-tab"
                    onClick={() => switchTab(t)}
                    style={{
                      color: tab === t ? '#6366f1' : '#777',
                      borderBottom: tab === t ? '2px solid #6366f1' : '2px solid transparent',
                    }}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </>
        )
      })()}

      {/* Date filter + review mode toggle */}
      {tab !== 'categories' && tab !== 'cashflow' && tab !== 'accounts' && tab !== 'amazon' && tab !== 'credit cards' && (
        <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {!reviewMode && !splitQueueMode && <DateFilter filter={filter} onChange={setFilter} />}
          {!reviewMode && !splitQueueMode && <span style={{ fontSize: 13, color: '#888' }}>{getFilterLabel(filter)}</span>}
          {tab === 'transactions' && (
            <>
              <button
                onClick={() => { setReviewMode(r => !r); setSplitQueueMode(false); setDuplicatesMode(false) }}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontWeight: 600, fontSize: 13,
                  cursor: 'pointer', border: '1px solid',
                  background: reviewMode ? '#fef9c3' : '#fff',
                  color: reviewMode ? '#854d0e' : '#555',
                  borderColor: reviewMode ? '#fde047' : '#ddd',
                }}
              >
                {reviewMode ? '⚠ Needs Review' : 'Needs Review'}
              </button>
              <button
                onClick={() => { setSplitQueueMode(s => !s); setReviewMode(false); setDuplicatesMode(false) }}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontWeight: 600, fontSize: 13,
                  cursor: 'pointer', border: '1px solid',
                  background: splitQueueMode ? '#fdf4ff' : '#fff',
                  color: splitQueueMode ? '#7e22ce' : '#555',
                  borderColor: splitQueueMode ? '#d8b4fe' : '#ddd',
                }}
              >
                {splitQueueMode ? '✂ Split Queue' : 'Split Queue'}
              </button>
              <button
                onClick={() => { setDuplicatesMode(d => !d); setReviewMode(false); setSplitQueueMode(false) }}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontWeight: 600, fontSize: 13,
                  cursor: 'pointer', border: '1px solid',
                  background: duplicatesMode ? '#fef2f2' : '#fff',
                  color: duplicatesMode ? '#dc2626' : '#555',
                  borderColor: duplicatesMode ? '#fca5a5' : '#ddd',
                }}
              >
                {duplicatesMode ? '⚠ Duplicates' : 'Duplicates'}
              </button>
            </>
          )}
        </div>
      )}

      {tab === 'dashboard' && (
        <div style={{ display: 'grid', gap: 24 }}>
          <section className="card">
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Spending by Category</h2>
            <SpendingByCategory startDate={startDate} endDate={endDate} />
          </section>

          <section className="card">
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Monthly Spending Trend</h2>
            <MonthlyTrend startDate={startDate} endDate={endDate} />
          </section>
        </div>
      )}

      {tab === 'transactions' && (
        <section className="card">
          {duplicatesMode ? (
            <DuplicatesView onResolved={loadData} />
          ) : (
            <TransactionList
              transactions={transactions}
              onUpdated={loadData}
              categories={categories}
              items={items}
              reviewMode={reviewMode}
              splitQueueMode={splitQueueMode}
              hasMore={hasMore}
              onLoadMore={loadMore}
            />
          )}
        </section>
      )}

      {tab === 'accounts' && (
        <section className="card">
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Linked Accounts</h2>
          <AccountsTab items={items} onRefresh={loadData} onImportCsv={() => setImporting(true)} onPlaidSuccess={loadData} />
        </section>
      )}

      {tab === 'amazon' && (
        <section className="card">
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Amazon Orders</h2>
          <AmazonTab />
        </section>
      )}

      {tab === 'cashflow' && (
        <section className="card">
          <CashflowTab />
        </section>
      )}

      {tab === 'credit cards' && (
        <section className="card">
          <CreditCardsTab />
        </section>
      )}

      {tab === 'categories' && (
        <section className="card">
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Category Management</h2>
          <CategoriesTab />
        </section>
      )}
    </div>
  )
}

