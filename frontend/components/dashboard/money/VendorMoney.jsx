import { useState } from 'react'
import { useVendorWalletOverview } from '../../../hooks/useWallet.js'
import { walletMessage } from '../../wallet/walletErrors.js'
import { walletStyles } from '../../wallet/walletStyles.js'
import VendorPayouts from '../../wallet/VendorPayouts.jsx'
import { D } from '../theme.js'
import MoneyOverview from './MoneyOverview.jsx'
import DailySummary from './DailySummary.jsx'
import SalesList from './SalesList.jsx'
import StatementDownload from './StatementDownload.jsx'
import FeesPage from './FeesPage.jsx'
import TextsSettings from './TextsSettings.jsx'

// The business dashboard's one Money tab (Director: Money and Payouts in one
// tab). Only the selected sub-tab is mounted, so no other request fires.
// Owner-only: it shows platform fees.
export default function VendorMoney({ businessKind }) {
  const s = walletStyles('dashboard')
  const [sub, setSub] = useState('overview')
  const { error, isLoading, refetch } = useVendorWalletOverview()

  if (error && walletMessage(error).kind === 'off') {
    return <div style={s.card}><div style={s.note}>{walletMessage(error).text}</div></div>
  }

  // Any other failure: one card and no sub-tabs. Mounting them would add a second observer whose refetch-on-mount
  // sends the query back to pending, which would unmount them again, in a loop that keeps hitting the server.
  if (error) {
    return (
      <div style={s.card}>
        <div role="alert" style={s.error}>
          {walletMessage(error).text}{' '}
          <button type="button" style={s.ghost} onClick={() => refetch()}>Try again</button>
        </div>
      </div>
    )
  }

  if (isLoading) return <div style={s.card}><div style={s.note}>Loading your money…</div></div>

  const SUB_TABS = [
    { id: 'overview', label: 'Overview', render: () => <MoneyOverview onOpenPayouts={() => setSub('payouts')} /> },
    { id: 'payouts', label: 'Payouts', render: () => <VendorPayouts /> },
    { id: 'sales', label: 'Sales', render: () => <SalesList businessKind={businessKind} /> },
    { id: 'daily', label: 'Daily', render: () => <DailySummary /> },
    { id: 'statement', label: 'Statement', render: () => <StatementDownload /> },
    { id: 'fees', label: 'Fees', render: () => <FeesPage /> },
    { id: 'texts', label: 'Texts', render: () => <TextsSettings /> },
  ]
  const current = SUB_TABS.find((t) => t.id === sub) || SUB_TABS[0]

  return (
    <div>
      <div style={{ borderBottom: `1px solid ${D.divider}`, marginBottom: 16, overflowX: 'auto' }}>
        <div role="tablist" aria-label="Money" style={{ display: 'flex' }}>
          {SUB_TABS.map((t) => {
            const on = current.id === t.id
            return (
              <button
                key={t.id} type="button" role="tab" aria-selected={on} onClick={() => setSub(t.id)}
                style={{
                  background: 'none', border: 'none',
                  borderBottom: on ? `3px solid ${D.gold}` : '3px solid transparent',
                  color: on ? D.text : D.textDim,
                  padding: '12px 16px', fontSize: '0.8rem', fontWeight: on ? 800 : 600,
                  cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 44,
                }}
              >{t.label}</button>
            )
          })}
        </div>
      </div>
      <div role="tabpanel">{current.render()}</div>
    </div>
  )
}
