import { useState, useCallback, useEffect } from 'react'
import { usePlaidLink } from 'react-plaid-link'
import { createUpdateLinkToken, completeItemUpdate } from '../api/client'

export default function PlaidReconnectButton({ itemId, onSuccess }) {
  const [linkToken, setLinkToken] = useState(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  const openLink = async () => {
    setLoading(true)
    setStatus('')
    try {
      const data = await createUpdateLinkToken(itemId)
      setLinkToken(data.link_token)
    } catch (e) {
      setStatus(`Error: ${e.message}`)
      setLoading(false)
    }
  }

  const onPlaidSuccess = useCallback(async (publicToken) => {
    try {
      setStatus('Updating…')
      if (publicToken) {
        await completeItemUpdate(itemId, publicToken)
      }
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
        style={{
          fontSize: 11, color: '#0284c7', background: 'none',
          border: '1px solid #bae6fd', borderRadius: 4, padding: '2px 8px',
          cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600,
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? 'Loading…' : 'Reconnect'}
      </button>
      {status && (
        <span style={{ fontSize: 11, color: status.startsWith('Error') ? '#ef4444' : '#15803d' }}>
          {status}
        </span>
      )}
    </span>
  )
}
