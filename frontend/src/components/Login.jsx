import { useState } from 'react'
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google'

const CLIENT_ID = '487216098102-dd4urhd1tro6fh83574r13mcm7l5u38q.apps.googleusercontent.com'

export default function Login({ onSuccess }) {
  const [error, setError] = useState(null)

  const handleSuccess = async (credentialResponse) => {
    setError(null)
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: credentialResponse.credential }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.detail || 'Login failed')
        return
      }
      onSuccess()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <GoogleOAuthProvider clientId={CLIENT_ID}>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100vh', background: '#f9fafb',
      }}>
        <div style={{
          background: '#fff', borderRadius: 12, padding: '40px 48px',
          boxShadow: '0 2px 16px rgba(0,0,0,0.08)', textAlign: 'center', maxWidth: 360,
        }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, color: '#111' }}>
            Personal Finance
          </h1>
          <p style={{ fontSize: 14, color: '#888', marginBottom: 28 }}>
            Sign in to continue
          </p>
          <GoogleLogin
            onSuccess={handleSuccess}
            onError={() => setError('Google sign-in failed')}
            useOneTap
          />
          {error && (
            <p style={{ marginTop: 16, fontSize: 13, color: '#dc2626' }}>{error}</p>
          )}
        </div>
      </div>
    </GoogleOAuthProvider>
  )
}
