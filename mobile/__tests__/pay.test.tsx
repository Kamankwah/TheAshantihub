import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { PayChoice } from "../src/features/pay/PayChoice";
import { usePayChoice } from "../src/features/pay/usePayChoice";
import { api, ApiError } from "../src/lib/api";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("../src/lib/api", () => {
  const actual = jest.requireActual("../src/lib/api");
  return { ...actual, api: jest.fn() };
});
const apiMock = api as jest.Mock;

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

function serve(wallet: unknown) {
  apiMock.mockImplementation(async (path: string) => {
    if (path === "/api/wallet/") {
      if (wallet instanceof ApiError) throw wallet;
      return wallet;
    }
    if (path === "/api/wallet/processing/") return { amount: "100.00", payment_processing: "1.50", you_pay: "101.50", provider: "simulated" };
    throw new ApiError(404, {});
  });
}
const off = () => new ApiError(409, { detail: "Wallets are off", code: "ledger_off" });

beforeEach(() => jest.clearAllMocks());

describe("usePayChoice", () => {
  it("wallet_enabled_when_ledger_on_and_balance_covers_the_amount", async () => {
    serve({ kind: "customer", balance: "250.00" });
    const { result } = await renderHook(() => usePayChoice({ amount: "100.00" }), { wrapper });
    await waitFor(() => expect(result.current.wallet.enabled).toBe(true));
    expect(result.current.body).toEqual({ payment_method: "momo" });
    await act(async () => result.current.setMethod("wallet"));
    expect(result.current.body).toEqual({ payment_method: "wallet" });
    expect(result.current.ready).toBe(true);
  });

  it("wallet_disabled_with_honest_reason_when_balance_too_low", async () => {
    serve({ kind: "customer", balance: "20.00" });
    const { result } = await renderHook(() => usePayChoice({ amount: "100.00" }), { wrapper });
    await waitFor(() => expect(result.current.wallet.note).toMatch(/Balance too low/));
    expect(result.current.wallet.enabled).toBe(false);
  });

  it("ledger_off_sends_no_payment_method_and_says_not_available_yet", async () => {
    serve(off());
    const { result } = await renderHook(() => usePayChoice({ amount: "100.00" }), { wrapper });
    await waitFor(() => expect(result.current.state).toBe("off"));
    expect(result.current.wallet).toEqual({ enabled: false, note: "Not available yet" });
    expect(result.current.body).toEqual({});
    expect(result.current.ready).toBe(true);
  });

  it("unknown_wallet_state_blocks_paying_instead_of_guessing", async () => {
    serve(new ApiError(500, {}));
    const { result } = await renderHook(() => usePayChoice({ amount: "100.00" }), { wrapper });
    await waitFor(() => expect(result.current.problem).toBeTruthy());
    expect(result.current.state).toBe("unknown");
    expect(result.current.ready).toBe(false);
  });

  it("momo_waits_for_the_processing_quote_and_shows_what_you_pay", async () => {
    serve({ kind: "customer", balance: "5.00" });
    const { result } = await renderHook(() => usePayChoice({ amount: "100.00" }), { wrapper });
    await waitFor(() => expect(result.current.processing).toBe("1.50"));
    expect(result.current.youPay).toBe("101.50");
    expect(result.current.ready).toBe(true);
  });

  it("organiser_outside_the_ledger_pays_by_momo_only_with_no_charge", async () => {
    serve({ kind: "customer", balance: "500.00" });
    const { result } = await renderHook(() => usePayChoice({ amount: "100.00", inLedger: false }), { wrapper });
    await waitFor(() => expect(result.current.state).toBe("off"));
    expect(result.current.wallet.enabled).toBe(false);
    expect(result.current.wallet.note).toMatch(/Mobile Money only/);
    expect(result.current.body).toEqual({});
  });
});

describe("PayChoice", () => {
  it("lists_momo_and_wallet_and_switches_to_wallet", async () => {
    serve({ kind: "customer", balance: "250.00" });
    function Host() {
      const choice = usePayChoice({ amount: "100.00" });
      return <PayChoice choice={choice} />;
    }
    await render(<Host />, { wrapper });
    const wallet = await screen.findByLabelText(/AshantiHub wallet, balance/i);
    await waitFor(() => expect(wallet.props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(wallet);
    expect(screen.getByLabelText(/AshantiHub wallet, balance/i).props.accessibilityState.selected).toBe(true);
  });

  it("momo_row_names_the_processing_charge", async () => {
    serve({ kind: "customer", balance: "5.00" });
    function Host() {
      return <PayChoice choice={usePayChoice({ amount: "100.00" })} />;
    }
    await render(<Host />, { wrapper });
    expect(await screen.findByText(/payment processing/i)).toBeTruthy();
    expect(screen.getByText(/GH₵\s?1\.50/)).toBeTruthy();
  });
});
