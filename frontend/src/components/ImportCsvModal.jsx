import { useState, useRef } from 'react'
import { importCsv } from '../api/client'

const INSTITUTIONS = ['Bank of America', 'Chase', 'Other']

const ACCOUNT_PRESETS = {
  'Bank of America': [
    { name: 'Credit Card', type: 'credit', subtype: 'credit card' },
    { name: 'Checking', type: 'depository', subtype: 'checking' },
    { name: 'Savings', type: 'depository', subtype: 'savings' },
  ],
  Chase: [
    { name: 'Disney Visa', type: 'credit', subtype: 'credit card' },
    { name: 'Prime Visa', type: 'credit', subtype: 'credit card' },
    { name: 'Sapphire Reserve', type: 'credit', subtype: 'credit card' },
    { name: 'Sapphire Preferred', type: 'credit', subtype: 'credit card' },
    { name: 'Freedom', type: 'credit', subtype: 'credit card' },
    { name: 'Freedom Unlimited', type: 'credit', subtype: 'credit card' },
    { name: 'Checking', type: 'depository', subtype: 'checking' },
  ],
  Other: [
    { name: 'Credit Card', type: 'credit', subtype: 'credit card' },
    { name: 'Checking', type: 'depository', subtype: 'checking' },
  ],
}

const FORMAT_HINTS = {
  Chase: 'Chase online → Account activity → Download → CSV',
  'Bank of America': 'BofA online → Account activity → Download → CSV',
  Other: 'Needs columns: date, description/payee, and amount',
}

export default function ImportCsvModal({ onClose, onImported }) {
  const [institution, setInstitution] = useState('Bank of America')
  const [accountName, setAccountName] = useState(ACCOUNT_PRESETS['Bank of America'][0].name)
  const [accountMask, setAccountMask] = useState('')
  const [accountType, setAccountType] = useState('credit')
  const [accountSubtype, setAccountSubtype] = useState('credit card')
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const fileRef = useRef()

  const handleInstitutionChange = (inst) => {
    setInstitution(inst)
    const preset = ACCOUNT_PRESETS[inst][0]
    setAccountName(preset.name)
    setAccountType(preset.type)
    setAccountSubtype(preset.subtype)
  }

  const handlePreset = (preset) => {
    setAccountName(preset.name)
    setAccountType(preset.type)
    setAccountSubtype(preset.subtype)
  }

  const handleFileChange = (e) => {
    setFile(e.target.files[0] || null)
    setResult(null)
    setError(null)
  }

  const handleSubmit = async () => {
    if (!file) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('institution_name', institution === 'Other' ? (accountName || 'Unknown') : institution)
      fd.append('account_name', accountName)
      fd.append('account_mask', accountMask)
      fd.append('account_type', accountType)
      fd.append('account_subtype', accountSubtype)
      const res = await importCsv(fd)
      setResult(res)
      onImported?.()
    } catch (err) {
      try {
        const body = JSON.parse(err.message)
        // FastAPI wraps detail under body.detail; normalise to {message, detected_headers}
        const detail = body.detail ?? body
        setError(typeof detail === 'string' ? { message: detail } : detail)
      } catch {
        setError({ message: err.message })
      }
    } finally {
      setLoading(false)
    }
  }

  const presets = ACCOUNT_PRESETS[institution] || []

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Import CSV Transactions</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>×</button>
        </div>

        {result ? (
          /* ── Success state ── */
          <div>
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 16, marginBottom: 20 }}>
              <div style={{ fontWeight: 700, color: '#15803d', marginBottom: 8 }}>Import complete</div>
              <div style={{ fontSize: 13, color: '#166534' }}>
                <div>Format detected: <strong>{result.format_detected.replace('_', ' ')}</strong></div>
                <div>Account: <strong>{result.account}</strong></div>
                <div style={{ marginTop: 8, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <span>✓ <strong>{result.added}</strong> added</span>
                  {result.skipped_duplicates > 0 && <span style={{ color: '#888' }}>⟳ {result.skipped_duplicates} duplicates skipped</span>}
                  {result.errors > 0 && <span style={{ color: '#ef4444' }}>✗ {result.errors} rows skipped (parse error)</span>}
                </div>
                {result.added > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <span style={{ color: '#166534' }}>🏷 <strong>{result.keywords_applied}</strong> auto-categorized</span>
                    {result.keywords_unmatched > 0 && <span style={{ color: '#92400e' }}>⚠ {result.keywords_unmatched} need review</span>}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => { setResult(null); setFile(null); if (fileRef.current) fileRef.current.value = '' }}
                style={{ flex: 1, padding: '8px 0', background: '#f3f4f6', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
              >
                Import another
              </button>
              <button
                onClick={onClose}
                style={{ flex: 1, padding: '8px 0', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          /* ── Form state ── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Institution */}
            <div>
              <label style={labelStyle}>Institution</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {INSTITUTIONS.map((inst) => (
                  <button
                    key={inst}
                    onClick={() => handleInstitutionChange(inst)}
                    style={{
                      padding: '6px 14px', border: '1px solid #ddd', borderRadius: 6,
                      cursor: 'pointer', fontSize: 13, fontWeight: 600,
                      background: institution === inst ? '#6366f1' : '#fff',
                      color: institution === inst ? '#fff' : '#444',
                    }}
                  >
                    {inst}
                  </button>
                ))}
              </div>
            </div>

            {/* Account name presets */}
            <div>
              <label style={labelStyle}>Account</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {presets.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => handlePreset(p)}
                    style={{
                      padding: '4px 10px', border: '1px solid #e5e7eb', borderRadius: 20,
                      cursor: 'pointer', fontSize: 12,
                      background: accountName === p.name ? '#e8eaf6' : '#f9fafb',
                      color: accountName === p.name ? '#4338ca' : '#555',
                      fontWeight: accountName === p.name ? 600 : 400,
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
              <input
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="Account name (e.g. Sapphire Reserve)"
                style={inputStyle}
              />
            </div>

            {/* Last 4 digits */}
            <div>
              <label style={labelStyle}>Last 4 digits <span style={{ color: '#aaa', fontWeight: 400 }}>(optional, helps distinguish cards)</span></label>
              <input
                value={accountMask}
                onChange={(e) => setAccountMask(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="e.g. 1234"
                maxLength={4}
                style={{ ...inputStyle, width: 80 }}
              />
            </div>

            {/* File picker */}
            <div>
              <label style={labelStyle}>CSV file</label>
              <div
                onClick={() => fileRef.current?.click()}
                style={{
                  border: '2px dashed #ddd', borderRadius: 8, padding: '20px 16px',
                  textAlign: 'center', cursor: 'pointer', color: file ? '#111' : '#888', fontSize: 13,
                  background: file ? '#f0fdf4' : '#fafafa',
                }}
              >
                {file ? `✓  ${file.name}` : 'Click to choose a .csv file'}
              </div>
              <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFileChange} style={{ display: 'none' }} />
              {institution !== 'Other' && (
                <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>{FORMAT_HINTS[institution]}</div>
              )}
            </div>

            {/* Error */}
            {error && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 12, fontSize: 13, color: '#991b1b' }}>
                <strong>Import failed:</strong> {error.message}
                {error.detected_headers && (
                  <div style={{ marginTop: 6, color: '#666' }}>
                    Found columns: {error.detected_headers.join(', ')}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={!file || loading || !accountName}
              style={{
                padding: '10px 0', background: !file || loading ? '#a5b4fc' : '#6366f1',
                color: '#fff', border: 'none', borderRadius: 6, cursor: !file ? 'not-allowed' : 'pointer',
                fontWeight: 700, fontSize: 14,
              }}
            >
              {loading ? 'Importing…' : 'Import'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6 }
const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }
