'use client'

import { DashboardTabs } from '@/components/marketplace/dashboard-tabs'
import { useLanguage } from '@/context/language-context'
import { PayoutClient } from '../payout/payout-client'
import { WalletClient } from '../wallet/wallet-client'

/** Payout first (VietQR bank transfer, the common VN case); the stablecoin wallet sits behind it. */
export function PaymentsClient() {
  const { tr } = useLanguage()
  return (
    <DashboardTabs
      title={tr('Payments', 'Thanh toán')}
      fallbackHref="/dashboard/listings"
      tabs={[
        { value: 'payout', label: tr('Bank payout', 'Nhận tiền'), content: <PayoutClient embedded /> },
        { value: 'wallet', label: tr('Wallet', 'Ví'), content: <WalletClient embedded /> },
      ]}
    />
  )
}
