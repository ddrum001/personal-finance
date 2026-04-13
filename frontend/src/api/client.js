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

export async function replaceItem(itemId, publicToken, institutionName) {
  const res = await fetch(`${BASE}/plaid/items/${itemId}/replace`, {
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

export async function setAccountExcluded(accountId, isExcluded) {
  const res = await fetch(`${BASE}/plaid/accounts/${accountId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_excluded: isExcluded }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function deleteItem(itemId) {
  const res = await fetch(`${BASE}/plaid/items/${itemId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getDuplicateTransactions() {
  const res = await fetch(`${BASE}/transactions/duplicates`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function dismissDuplicateGroup(transactionIds) {
  const res = await fetch(`${BASE}/transactions/duplicates/dismiss`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction_ids: transactionIds }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function deleteTransaction(transactionId) {
  const res = await fetch(`${BASE}/transactions/${transactionId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
}

export async function getTransactions({ startDate, endDate, category, budgetSubCategory, budgetSubCategories, budgetCategory, budgetMacroCategory, accountId, needsReview, limit, offset } = {}) {
  const params = new URLSearchParams()
  if (startDate) params.set('start_date', startDate)
  if (endDate) params.set('end_date', endDate)
  if (category) params.set('category', category)
  if (budgetSubCategories?.length) {
    budgetSubCategories.forEach(s => params.append('budget_sub_categories', s))
  } else if (budgetSubCategory) {
    params.set('budget_sub_category', budgetSubCategory)
  }
  if (budgetCategory) params.set('budget_category', budgetCategory)
  if (budgetMacroCategory) params.set('budget_macro_category', budgetMacroCategory)
  if (accountId) params.set('account_id', accountId)
  if (needsReview != null) params.set('needs_review', needsReview)
if (limit != null) params.set('limit', limit)
  if (offset != null) params.set('offset', offset)
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

export async function rejectSuggestion(transactionId) {
  const res = await fetch(`${BASE}/transactions/${transactionId}/reject-suggestion`, { method: 'PATCH' })
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

export async function renameSubCategory(id, newName) {
  const res = await fetch(`${BASE}/categories/${id}/rename`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_name: newName }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function renameCategory(oldName, newName) {
  const res = await fetch(`${BASE}/categories/rename-category`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ old_name: oldName, new_name: newName }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function deleteSubCategory(id) {
  const res = await fetch(`${BASE}/categories/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function deleteCategoryGroup(category, macro) {
  const params = new URLSearchParams({ category, macro })
  const res = await fetch(`${BASE}/categories/delete-category?${params}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function deleteMacroGroup(macro) {
  const params = new URLSearchParams({ macro })
  const res = await fetch(`${BASE}/categories/delete-macro?${params}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function moveSubCategory(id, newCategory, newMacro) {
  const res = await fetch(`${BASE}/categories/${id}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_category: newCategory, new_macro_category: newMacro }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function moveCategoryToMacro(category, oldMacro, newMacro) {
  const res = await fetch(`${BASE}/categories/move-category`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, old_macro: oldMacro, new_macro: newMacro }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function renameMacro(oldName, newName) {
  const res = await fetch(`${BASE}/categories/rename-macro`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ old_name: oldName, new_name: newName }),
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
// Gmail / Amazon
// ---------------------------------------------------------------------------

export async function getGmailStatus() {
  const res = await fetch(`${BASE}/gmail/status`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getGmailConnectUrl() {
  const res = await fetch(`${BASE}/gmail/connect`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function disconnectGmail() {
  const res = await fetch(`${BASE}/gmail/disconnect`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function syncAmazonOrders() {
  const res = await fetch(`${BASE}/gmail/amazon/sync`, { method: 'POST' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getAmazonOrders() {
  const res = await fetch(`${BASE}/gmail/amazon/orders`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function linkAmazonOrder(orderId, transactionId) {
  const res = await fetch(`${BASE}/gmail/amazon/orders/${orderId}/link`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction_id: transactionId }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function unlinkAmazonOrder(orderId) {
  const res = await fetch(`${BASE}/gmail/amazon/orders/${orderId}/link`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function automatchAmazonOrders() {
  const res = await fetch(`${BASE}/gmail/amazon/automatch`, { method: 'POST' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function dismissAmazonOrder(orderId) {
  const res = await fetch(`${BASE}/gmail/amazon/orders/${orderId}/dismiss`, { method: 'PATCH' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function restoreAmazonOrder(orderId) {
  const res = await fetch(`${BASE}/gmail/amazon/orders/${orderId}/restore`, { method: 'PATCH' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function reparseAmazonOrders({ onlyMissing = true, offset = 0 } = {}) {
  const res = await fetch(`${BASE}/gmail/amazon/reparse?only_missing=${onlyMissing}&offset=${offset}`, { method: 'POST' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getAmazonOrderCandidates(orderId) {
  const res = await fetch(`${BASE}/gmail/amazon/orders/${orderId}/candidates`)
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

export async function getCashflowProjection(days = 14) {
  const res = await fetch(`${BASE}/cashflow/projection?days=${days}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getRecurringSuggestions(months = 6) {
  const res = await fetch(`${BASE}/cashflow/suggestions?months=${months}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ---------------------------------------------------------------------------
// Credit cards
// ---------------------------------------------------------------------------

export async function getCreditCards() {
  const res = await fetch(`${BASE}/credit-cards`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function refreshLiabilities() {
  const res = await fetch(`${BASE}/credit-cards/liabilities/refresh`, { method: 'POST' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function refreshCardLiabilities(accountId) {
  const res = await fetch(`${BASE}/credit-cards/${accountId}/liabilities/refresh`, { method: 'POST' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function checkSchedulePayment(accountId) {
  const res = await fetch(`${BASE}/credit-cards/${accountId}/schedule-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'check' }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function confirmSchedulePayment(accountId, action, replaceId = null) {
  const res = await fetch(`${BASE}/credit-cards/${accountId}/schedule-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, replace_id: replaceId }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function createPromoBalance(body) {
  const res = await fetch(`${BASE}/credit-cards/promos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function updatePromoBalance(id, body) {
  const res = await fetch(`${BASE}/credit-cards/promos/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function deletePromoBalance(id) {
  const res = await fetch(`${BASE}/credit-cards/promos/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
}

export async function planPromoPayments(promoId, numPayments, startDate) {
  const res = await fetch(`${BASE}/credit-cards/promos/${promoId}/plan-payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ num_payments: numPayments, start_date: startDate }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getAutopay(accountId) {
  const res = await fetch(`${BASE}/credit-cards/${accountId}/autopay`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function setAutopay(accountId, body) {
  const res = await fetch(`${BASE}/credit-cards/${accountId}/autopay`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function clearAutopay(accountId) {
  const res = await fetch(`${BASE}/credit-cards/${accountId}/autopay`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
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
