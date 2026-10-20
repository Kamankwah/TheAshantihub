import { useVendorWalletOverview, useWallet } from '../../hooks/useWallet.js'
import { formatAccraDayTime } from '../../lib/accraTime.js'
import { walletMessage } from './walletErrors.js'
import { formatGhs, pesewasToGhs } from './walletMoney.js'
import { walletStyles } from './walletStyles.js'

// The wallet at a glance: a customer's balance, or a vendor's Pending and
// Available. Everything shown is what the server sent.
export default function BalanceSummary({ tone = 'light', basePath = '/api/wallet' }) {
  const s = walletStyles(tone)
  const wallet = useWallet({ basePath })
  const data = wallet.data
  const vendor = useVendorWalletOverview({ enabled: data?.kind === 'vendor' })

  if (wallet.isLoading) return <div style={s.card}><div style={s.note}>Loading your wallet…</div></div>
  if (wallet.error) {
    const m = walletMessage(wallet.error)
    return <div style={s.card}><div style={m.kind === 'off' ? s.note : s.error}>{m.text}</div></div>
  }
  if (!data) return null

  if (data.kind === 'vendor') {
    return (
      <div style={s.card}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <span style={s.label}>Pending</span>
            <div style={{ ...s.amount, fontSize: 22 }}>{formatGhs(data.pending)}</div>
            <div style={s.note}>Money waiting for Support's call or the release time.</div>
          </div>
          <div>
            <span style={s.label}>Available</span>
            <div style={{ ...s.amount, fontSize: 22 }}>{formatGhs(data.available)}</div>
          </div>
        </div>
        {vendor.data?.negative === true && (
          <div style={{ ...s.note, marginTop: 12 }}>
            Available is below zero after a late refund; withdrawals wait until it is recovered.
          </div>
        )}
      </div>
    )
  }

  const held = Number(data.held_topup_pesewas) > 0
  const freeAt = held ? formatAccraDayTime(data.topup_free_at) : null
  return (
    <div style={s.card}>
      <span style={s.label}>AshantiHub wallet</span>
      <div style={{ ...s.amount, fontSize: 28 }}>{formatGhs(data.balance)}</div>
      {held && freeAt && (
        <div style={{ ...s.note, marginTop: 8 }}>
          {pesewasToGhs(data.held_topup_pesewas)} of this was topped up and can be withdrawn from {freeAt}.
        </div>
      )}
    </div>
  )
}
