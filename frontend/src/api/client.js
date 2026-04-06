const BASE = '/api'

export async function createLinkToken() {
  const res = await fetch(`${BASE}/plaid/link/token/create`, { method: 'POST' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function exchangePublicToken(publicToken, institutionName) {
  const res = await fetch(`${BASE}/plaid/link/token/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_token: publicToken, institution_name: institutionName }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function syncTransactions() {
  const res = await fetch(`${BASE}/plaid/transactions/sync`, { method: 'POST' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function syncItem(itemId) {
  const res = await fetch(`${BASE}/plaid/items/${itemId}/sync`, { method: 'POST' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function listItems() {
  const res = await fetch(`${BASE}/plaid/items`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function updateAccountNickname(accountId, nickname) {
  const res = await fetch(`${BASE}/plaid/accounts/${accountId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function deleteItem(itemId) {
  const res = await fetch(`${BASE}/plaid/items/${itemId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getTransactions({ startDate, endDate, category, accountId, needsReview, needsSplits } = {}) {
  const params = new URLSearchParams()
  if (startDate) params.set('start_date', startDate)
  if (endDate) params.set('end_date', endDate)
  if (category) params.set('category', category)
  if (accountId) params.set('account_id', accountId)
  if (needsReview != null) params.set('needs_review', needsReview)
  if (needsSplits != null) params.set('needs_splits', needsSplits)
  const res = await fetch(`${BASE}/transactions/?${params}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getTemplates() {
  const res = await fetch(`${BASE}/templates/`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function createTemplate(body) {
  const res = await fetch(`${BASE}/templates/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function updateTemplate(id, body) {
  const res = await fetch(`${BASE}/templates/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function deleteTemplate(id) {
  const res = await fetch(`${BASE}/templates/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
}

export async function markReviewed(transactionId) {
  const res = await fetch(`${BASE}/transactions/${transactionId}/reviewed`, { method: 'PATCH' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function flagForReview(transactionId) {
  const res = await fetch(`${BASE}/transactions/${transactionId}/flag-review`, { method: 'PATCH' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function acceptSuggestions() {
  const res = await fetch(`${BASE}/transactions/accept-suggestions`, { method: 'POST' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function markReviewedBulk(transactionIds) {
  const res = await fetch(`${BASE}/transactions/mark-reviewed-bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction_ids: transactionIds }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getSplits(transactionId) {
  const res = await fetch(`${BASE}/transactions/${transactionId}/splits`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function saveSplits(transactionId, splits) {
  const res = await fetch(`${BASE}/transactions/${transactionId}/splits`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ splits }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function deleteSplits(transactionId) {
  await fetch(`${BASE}/transactions/${transactionId}/splits`, { method: 'DELETE' })
}

export async function updateCategory(transactionId, customCategory) {
  const res = await fetch(`${BASE}/transactions/${transactionId}/category`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ custom_category: customCategory }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getCategoryBreakdown(startDate, endDate, groupBy = 'category', { filterMacro, filterCategory } = {}) {
  const params = new URLSearchParams({ start_date: startDate, end_date: endDate, group_by: groupBy })
  if (filterMacro) params.set('filter_macro', filterMacro)
  if (filterCategory) params.set('filter_category', filterCategory)
  const res = await fetch(`${BASE}/transactions/summary/by-category?${params}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getCategories() {
  const res = await fetch(`${BASE}/categories/`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getCategoryHierarchy() {
  const res = await fetch(`${BASE}/categories/hierarchy`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function addKeyword(categoryId, keyword) {
  const res = await fetch(`${BASE}/categories/${categoryId}/keywords`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function deleteKeyword(keywordId) {
  const res = await fetch(`${BASE}/categories/keywords/${keywordId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
}

export async function createCategory(body) {
  const res = await fetch(`${BASE}/categories/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function updateCategoryFlags(categoryId, isDiscretionary, isRecurring) {
  const res = await fetch(`${BASE}/categories/${categoryId}/flags`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_discretionary: isDiscretionary, is_recurring: isRecurring }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function setHideFromReports(categoryId, hide) {
  const res = await fetch(`${BASE}/categories/${categoryId}/hide-from-reports`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hide }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function setMacroHideFromReports(macroCategory, hide) {
  const res = await fetch(`${BASE}/categories/macro-hide`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ macro_category: macroCategory, hide }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function applyKeywords() {
  const res = await fetch(`${BASE}/categories/apply-keywords`, { method: 'POST' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function updateBudgetCategory(transactionId, budgetSubCategory) {
  const res = await fetch(`${BASE}/transactions/${transactionId}/budget-category`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ budget_sub_category: budgetSubCategory }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function importCsv(formData) {
  const res = await fetch(`${BASE}/import/csv`, { method: 'POST', body: formData })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getImportFormats() {
  const res = await fetch(`${BASE}/import/formats`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ---------------------------------------------------------------------------
// Cashflow
// ---------------------------------------------------------------------------

export async function getCashflowEntries() {
  const res = await fetch(`${BASE}/cashflow/entries`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function createCashflowEntry(body) {
  const res = await fetch(`${BASE}/cashflow/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function updateCashflowEntry(id, body) {
  const res = await fetch(`${BASE}/cashflow/entries/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function deleteCashflowEntry(id) {
  const res = await fetch(`${BASE}/cashflow/entries/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
}

export async function getCashflowProjection(months = 6) {
  const res = await fetch(`${BASE}/cashflow/projection?months=${months}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function refreshCashflowBalances() {
  const res = await fetch(`${BASE}/cashflow/balance/refresh`, { method: 'POST' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getMonthlyTrend({ startDate, endDate, months = 6 } = {}) {
  const params = new URLSearchParams({ months })
  if (startDate) params.set('start_date', startDate)
  if (endDate) params.set('end_date', endDate)
  const res = await fetch(`${BASE}/transactions/summary/monthly-trend?${params}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
