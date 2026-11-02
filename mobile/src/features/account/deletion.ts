const REASONS: Record<string, string> = {
  open_orders: "You have orders that are not finished yet. Wait until they are delivered or collected, or cancelled, then try again.",
  open_withdrawal: "You have a withdrawal that is still being processed. Try again once it has been paid out.",
  active_booking: "You have a booking that has not finished. Try again after your stay, or after you cancel it.",
  open_service_request: "You have a service request that is still open. Wait until it is finished or cancelled.",
  live_listings: "You still have live listings. Take them down first, then try again.",
  active_promotion: "You have a promotion that is still running. Let it end, then try again.",
  wallet_balance: "There is still money in your AshantiHub wallet. Spend it or withdraw it first.",
  company_account: "A company account can’t be deleted in the app. Contact Support and we will help.",
};

/** A plain sentence for each reason the server can give for refusing a deletion. */
export function reasonText(code: string): string {
  return REASONS[code] ?? "Something on your account needs attention first. Contact Support and we will help.";
}
