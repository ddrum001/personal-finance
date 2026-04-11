import { useState, useCallback, useEffect } from 'react'
import { usePlaidLink } from 'react-plaid-link'
import { createLinkToken, replaceItem } from '../api/client'

/**
 * Opens a fresh Plaid Link session and replaces the given item in place,
 * migrating all transactions/promos/cashflow to the new account IDs.
 * This is the correct way to add new Plaid products (e.g. liabilities) to
 * an existing connection — update mode cannot add products.
 */
export default function PlaidReconnectButton({ itemId, onSuccess }) {
  const [linkToken, setLinkToken] = useState(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  const openLink = async () => {
    setLoading(true)
    setStatus('')
    try {
      const data = await createLinkToken()
      setLinkToken(data.link_token)
    } catch (e) {
      setStatus(`Error: ${e.message}`)
      setLoading(false)
    }
  }

  const onPlaidSuccess = useCallback(async (publicToken, metadata) => {
    const institutionName = metadata?.institution?.name
    try {
      setStatus('Migrating…')
      await replaceItem(itemId, publicToken, institutionName)
      setStatus('Done!')
      setLinkToken(null)
      onSuccess?.()
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }, [itemId, onSuccess])

  const onExit = useCallback(() => {
    setLinkToken(null)
    setLoading(false)
  }, [])

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: onPlaidSuccess,
    onExit,
  })

  useEffect(() => {
    if (linkToken && ready) {
      setLoading(false)
      open()
    }
  }, [linkToken, ready, open])

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button
        onClick={openLink}
        disabled={loading}
        title="Re-connect this institution to enable credit card statement data (liabilities). Your transaction history will be preserved."
        style={{
          fontSize: 11, color: '#0284c7', background: 'none',
          border: '1px solid #bae6fd', borderRadius: 4, padding: '2px 8px',
          cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600,
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? 'Loading…' : 'Re-link'}
      </button>
      {status && (
        <span style={{ fontSize: 11, color: status.startsWith('Error') ? '#ef4444' : '#15803d' }}>
          {status}
        </span>
      )}
    </span>
  )
}
