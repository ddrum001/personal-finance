export default function HelpModal({ onClose }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: 28, maxWidth: 640, width: '100%',
        maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>How to use Personal Finance</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>×</button>
        </div>

        <Section title="Keeping transactions up to date">
          <p>Use <b>Sync All</b> in the top-right to pull in the latest transactions from all linked bank accounts. You can also sync a single institution from the <b>Accounts</b> tab.</p>
          <p>To add a new bank account, click <b>Link Account</b>. To import older history from a CSV export, use <b>Import CSV</b>.</p>
        </Section>

        <Section title="Reviewing &amp; categorizing transactions">
          <p>Click <b>Needs Review</b> on the Transactions tab to enter review mode. Transactions are split into two groups:</p>
          <ul>
            <li><b style={{ color: '#15803d' }}>Suggested</b> — the app matched a keyword and proposed a category. You can:
              <ul>
                <li><b>✓ Accept</b> — confirm the suggestion</li>
                <li><b>Change</b> — pick a different category inline</li>
                <li><b>✗ Defer</b> — move it to the Needs Category group to handle later</li>
              </ul>
              Use <b>Accept all remaining suggestions</b> to approve everything at once after spot-checking.
            </li>
            <li style={{ marginTop: 8 }}><b style={{ color: '#92400e' }}>Needs Category</b> — no suggestion was made. Use the dropdown to pick a category; it saves automatically.</li>
          </ul>
        </Section>

        <Section title="Applying keyword rules">
          <p>Keyword rules automatically suggest categories for new transactions. To apply them to older uncategorized transactions, go to the <b>Categories</b> tab and click <b>Apply Keywords</b>. This only fills in transactions with no category — it never overwrites existing ones.</p>
          <p>To add new keywords, expand any category in the Categories tab and type a keyword (e.g. "amazon", "netflix").</p>
        </Section>

        <Section title="Splitting transactions">
          <p>Use <b>Split</b> on any transaction to divide it across multiple categories (e.g. a Costco run that's part groceries, part household). You can apply a saved template or create a custom split.</p>
        </Section>

        <Section title="Managing accounts">
          <p>The <b>Accounts</b> tab shows all linked institutions and their accounts. From here you can:</p>
          <ul>
            <li>Set a <b>nickname</b> for any account (shown throughout the app)</li>
            <li><b>Exclude</b> an account to stop syncing it (e.g. a joint account connected under two logins)</li>
            <li><b>Remove</b> a bank connection you no longer need</li>
          </ul>
        </Section>

        <Section title="Amazon order linking">
          <p>Connect Gmail on the <b>Accounts</b> tab to pull in Amazon order confirmation emails. Only emails from <code>auto-confirm@amazon.com</code> are ever fetched. Once synced, go to the <b>Amazon</b> tab to link each order to its matching transaction.</p>
          <p><b>Syncing orders:</b> Click <b>Sync Amazon Orders</b> on the Accounts tab. New orders are added; already-synced orders are skipped.</p>
          <p><b>Linking an order to a transaction:</b> On the Amazon tab, unmatched orders have a <b>Link Transaction</b> button. This opens a list of nearby Amazon transactions sorted by closest dollar amount — pick the one that matches and click <b>Link</b>.</p>
          <p><b>Once linked:</b> The transaction shows an orange <b>📦 Amazon order</b> badge on the Transactions tab. Click it to expand the order details (Grand Total, item list, link to the original email) — useful for deciding how to categorize or split the transaction.</p>
          <p><b>Reparsing:</b> The <b>Reparse All Orders</b> button re-fetches every order's original email and re-runs the parser (useful after parser improvements). The result shows:</p>
          <ul>
            <li><b>updated</b> — emails successfully fetched and processed (items/subtotals written)</li>
            <li><b>failed</b> — hard errors: Gmail API exceptions or emails with no HTML body / no order ID (almost always 0)</li>
            <li><b>couldn't be parsed</b> — orders where no Grand Total dollar amount was found in the email (typically older email formats or shipping notifications that slipped through the sender filter)</li>
          </ul>
        </Section>

        <Section title="Cashflow">
          <p>The <b>Cashflow</b> tab lets you plan ahead by adding future income and expenses. Recurring entries (monthly, weekly, etc.) project forward automatically so you can see your expected balance over time.</p>
        </Section>

        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #f0f0f0', fontSize: 12, color: '#aaa', textAlign: 'center' }}>
          Tip: pending transactions are shown with a <b style={{ color: '#6366f1' }}>PENDING</b> badge and will update once they settle.
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#6366f1', marginBottom: 8, marginTop: 0 }}>{title}</h3>
      <div style={{ fontSize: 13, color: '#444', lineHeight: 1.6 }}>{children}</div>
    </div>
  )
}
