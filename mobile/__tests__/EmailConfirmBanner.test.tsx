import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { EmailConfirmBanner } from "../src/features/business/EmailConfirmBanner";
import { ApiError, api } from "../src/lib/api";

jest.mock("expo-router", () => ({ router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() } }));
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
beforeEach(() => jest.clearAllMocks());

const unconfirmed = { live: false, blockers: [{ code: "email_unconfirmed", message: "Confirm your email." }] };
const missing = { live: false, blockers: [{ code: "email_missing", message: "Add an email address so we can confirm it." }] };

describe("email confirm banner", () => {
  it("shows_nothing_without_go_live_or_for_other_blockers_or_when_live", async () => {
    const { rerender } = await render(<EmailConfirmBanner />);
    expect(screen.queryByText("Confirm your email to publish listings")).toBeNull();
    await rerender(<EmailConfirmBanner goLive={{ live: false, blockers: [{ code: "hours_missing", message: "Add hours." }] }} />);
    expect(screen.queryByText("Confirm your email to publish listings")).toBeNull();
    await rerender(<EmailConfirmBanner goLive={{ live: true, blockers: [] }} />);
    expect(screen.queryByText("Confirm your email to publish listings")).toBeNull();
  });

  it("stays_hidden_for_a_rejected_application_even_with_an_email_blocker", async () => {
    await render(<EmailConfirmBanner goLive={{ live: false, blockers: [...unconfirmed.blockers, { code: "kyc_rejected", message: "Your application needs changes." }] }} />);
    expect(screen.queryByText("Confirm your email to publish listings")).toBeNull();
  });

  it("offers_resend_when_the_email_is_unconfirmed", async () => {
    await render(<EmailConfirmBanner goLive={unconfirmed} />);
    expect(screen.getByText("Confirm your email to publish listings")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resend" })).toBeTruthy();
  });

  it("shows_the_server_sentence_and_no_resend_when_the_email_is_missing", async () => {
    await render(<EmailConfirmBanner goLive={missing} />);
    expect(screen.getByText("Add an email address so we can confirm it.")).toBeTruthy();
    expect(screen.getByText("Add your email in Profile & Settings (Request a change) so we can send you a confirmation link.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resend" })).toBeNull();
  });

  it("resend_posts_and_says_sent_without_naming_an_address", async () => {
    apiMock.mockResolvedValue(undefined);
    await render(<EmailConfirmBanner goLive={unconfirmed} />);
    await fireEvent.press(screen.getByRole("button", { name: "Resend" }));
    expect(await screen.findByText("Sent. Check your inbox (and your spam folder).")).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith("/api/accounts/business-owners/me/email-confirmation/", { body: {} });
  });

  it("shows_the_servers_throttle_message", async () => {
    apiMock.mockRejectedValue(new ApiError(429, { detail: "Too many requests. Try again tomorrow." }));
    await render(<EmailConfirmBanner goLive={unconfirmed} />);
    await fireEvent.press(screen.getByRole("button", { name: "Resend" }));
    expect(await screen.findByText("Too many requests. Try again tomorrow.")).toBeTruthy();
    expect(screen.queryByText(/^Sent\./)).toBeNull();
  });

  it("falls_back_to_a_plain_message_when_the_request_fails_without_a_reason", async () => {
    apiMock.mockRejectedValue(new Error("network"));
    await render(<EmailConfirmBanner goLive={unconfirmed} />);
    await fireEvent.press(screen.getByRole("button", { name: "Resend" }));
    await waitFor(() => expect(screen.getByText("We couldn't send the link. Check your connection and try again.")).toBeTruthy());
  });
});
