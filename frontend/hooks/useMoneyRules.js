import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/ledger/settings/ — every governed money setting (needs fees.view or fees.manage).
//   {settings: [{key, label, value, default, is_default, nullable, minimum, maximum, scheduled: [{value, effective_from}]}],
//    pending: [{id, key, value, maker, created_at}], history: [{key, value, effective_from}]}
// GET /api/ledger/fees/ — platform-fee tiers per category.
//   {current: [{category, label, bands: [{lower, upper, percent_bp, flat}], effective_from}],
//    pending: [{id, category, bands, effective_from, maker, created_at}], history: [...]}
// Amounts in the bands and in *_pesewas settings are whole pesewas; percent_bp is basis points (100 = 1%).
// Save with apiPost('/api/ledger/settings/', {key, value, note?}) / apiPost('/api/ledger/fees/', {category, bands, note?});
// both answer {approval_id, status}: a Super Admin's own change applies at once, anyone else's waits for one.
// Both keys start with 'ledger' so a live update on the ledger refreshes them.
export function useMoneySettings() {
  return useQuery({ queryKey: ['ledger', 'settings'], queryFn: () => apiFetch('/api/ledger/settings/') })
}

export function useFeeRules() {
  return useQuery({ queryKey: ['ledger', 'fees'], queryFn: () => apiFetch('/api/ledger/fees/') })
}
