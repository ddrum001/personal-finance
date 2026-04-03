import { useState, useCallback, useEffect } from 'react'
import { usePlaidLink } from 'react-plaid-link'
import { createLinkToken, exchangePublicToken, syncTransactions } from '../api/client'

const STORAGE_KEY = 'plaid_link_token'

export default function PlaidLinkButton({ onSuccess }) {
  const [linkToken, setLinkToken] = useState(null)
  const [receivedRedirectUri, setReceivedRedirectUri] = useState(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  // On mount: check if we've been redirected back from an OAuth bank (e.g. BofA)
  useEffect(() => {
    if (window.location.href.includes('oauth_state_id')) {
      const stored = sessionStorage.getItem(STORAGE_KEY)
      if (stored) {
        setReceivedRedirectUri(window.location.href)
        setLinkToken(stored)
        setStatus('Resuming bank connection…')
      }
    }
  }, [])

  const openLink = async () => {
    setLoading(true)
    setStatus('')
    try {
      const data = await createLinkToken()
      sessionStorage.setItem(STORAGE_KEY, data.link_token)
      setLinkToken(data.link_token)
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  const onPlaidSuccess = useCallback(async (publicToken, metadata) => {
    sessionStorage.removeItem(STORAGE_KEY)
    // Clear oauth_state_id from URL without reloading
    window.history.replaceState({}, '', window.location.pathname)
    const institutionName = metadata?.institution?.name
    try {
      setStatus('Exchanging token…')
      await exchangePublicToken(publicToken, institutionName)
      setStatus('Syncing transactions…')
      const result = await syncTransactions()
      setStatus(`Linked! Synced ${result.added} transactions.`)
      setLinkToken(null)
      setReceivedRedirectUri(null)
      onSuccess?.()
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }, [onSuccess])

  const onExit = useCallback(() => {
    setLinkToken(null)
    setReceivedRedirectUri(null)
    sessionStorage.removeItem(STORAGE_KEY)
    // Clear oauth_state_id from URL if present
    if (window.location.href.includes('oauth_state_id')) {
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: onPlaidSuccess,
    onExit,
    ...(receivedRedirectUri ? { receivedRedirectUri } : {}),
  })

  // Auto-open Plaid Link once token is ready (initial flow or OAuth resume)
  useEffect(() => {
    if (linkToken && ready) open()
  }, [linkToken, ready, open])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
      <button
        onClick={openLink}
        disabled={loading}
        style={{
          padding: '10px 20px',
          background: '#00b050',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: loading ? 'not-allowed' : 'pointer',
          fontWeight: 600,
        }}
      >
        {loading ? 'Loading...' : 'Connect Bank Account'}
      </button>
      {status && <p style={{ fontSize: 13, color: '#555' }}>{status}</p>}
    </div>
  )
}
