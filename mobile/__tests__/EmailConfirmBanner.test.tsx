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

  it("missing_email_shows_the_server_sentence_a_field_and_send_me_a_link_but_no_resend", async () => {
    await render(<EmailConfirmBanner goLive={missing} />);
    expect(screen.getByText("Add an email address so we can confirm it.")).toBeTruthy();
    expect(screen.getByLabelText("Email address")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send me a link" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resend" })).toBeNull();
    expect(screen.queryByText(/Request a change/)).toBeNull();
  });

  async function fill(email: string, password: string | null = "my-password") {
    await fireEvent.changeText(screen.getByLabelText("Email address"), email);
    if (password !== null) await fireEvent.changeText(screen.getByLabelText("Your password"), password);
    await fireEvent.press(screen.getByRole("button", { name: "Send me a link" }));
  }

  it("the_form_has_visible_labels_a_secure_password_field_and_says_why", async () => {
    await render(<EmailConfirmBanner goLive={missing} />);
    expect(screen.getByText("Email address")).toBeTruthy();
    expect(screen.getByText("Your password")).toBeTruthy();
    expect(screen.getByLabelText("Your password").props.secureTextEntry).toBe(true);
    expect(screen.getByLabelText("Your password").props.autoComplete).toBe("current-password");
    expect(screen.getByText("We ask for your password because this address can reset your account.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("refuses_a_malformed_address_without_calling_the_server", async () => {
    await render(<EmailConfirmBanner goLive={missing} />);
    await fill("not-an-email");
    expect(await screen.findByText("Enter your email so we can send you a confirmation link.")).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("refuses_a_blank_password_without_calling_the_server", async () => {
    await render(<EmailConfirmBanner goLive={missing} />);
    await fill("abena@example.com", "");
    expect(await screen.findByText("Enter your current password to continue.")).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("sends_the_trimmed_address_and_password_says_where_it_went_asks_for_a_refresh_and_clears_the_password", async () => {
    apiMock.mockResolvedValue({ email: "abena@example.com", sent: true });
    const onSaved = jest.fn();
    await render(<EmailConfirmBanner goLive={missing} onSaved={onSaved} />);
    await fill("  abena@example.com  ");
    expect(await screen.findByText("Sent to abena@example.com")).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith("/api/accounts/business-owners/me/email/", { body: { email: "abena@example.com", password: "my-password" } });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Your password")).toBeNull();
  });

  it("shows_the_wrong_password_sentence_and_clears_what_was_typed", async () => {
    apiMock.mockRejectedValue(new ApiError(400, { detail: "That password isn't right.", password: ["That password isn't right."], code: "wrong_password" }));
    const onSaved = jest.fn();
    await render(<EmailConfirmBanner goLive={missing} onSaved={onSaved} />);
    await fill("abena@example.com", "bad-guess");
    expect(await screen.findByText("That password isn't right.")).toBeTruthy();
    expect(screen.getByLabelText("Your password").props.value).toBe("");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("shows_the_servers_email_message_on_a_400", async () => {
    apiMock.mockRejectedValue(new ApiError(400, { email: ["A business owner with this email already exists."] }));
    const onSaved = jest.fn();
    await render(<EmailConfirmBanner goLive={missing} onSaved={onSaved} />);
    await fill("abena@example.com");
    expect(await screen.findByText("A business owner with this email already exists.")).toBeTruthy();
    expect(screen.queryByText(/^Sent to/)).toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("says_to_use_the_website_when_the_email_is_already_confirmed_not_the_servers_pointer", async () => {
    apiMock.mockRejectedValue(new ApiError(403, { detail: "Your email is confirmed. Change it in Profile & Settings, Request a change.", code: "email_confirmed" }));
    await render(<EmailConfirmBanner goLive={missing} />);
    await fill("abena@example.com");
    expect(await screen.findByText("Your email is already confirmed. To change it, sign in on the website and use Profile & Settings → Request a change.")).toBeTruthy();
    expect(screen.queryByText(/Your email is confirmed\. Change it/)).toBeNull();
  });

  it("on_the_daily_limit_shows_the_servers_sentence_and_still_refreshes", async () => {
    apiMock.mockRejectedValue(new ApiError(429, { detail: "Too many links today. Try Resend tomorrow.", code: "too_many_links" }));
    const onSaved = jest.fn();
    await render(<EmailConfirmBanner goLive={missing} onSaved={onSaved} />);
    await fill("abena@example.com");
    expect(await screen.findByText("Too many links today. Try Resend tomorrow.")).toBeTruthy();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("asks_for_a_code_with_the_shared_step_up_screen_then_retries_with_its_token_and_clears_the_password", async () => {
    const stepUp = new ApiError(403, { code: "step_up_required", action: "contact_change", detail: "Confirm it's you with a code first." });
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === "/api/otp/step-up/send/") return { hint: "+233 ••• 4417" };
      if (path === "/api/otp/step-up/verify/") return { step_up_token: "tok-1" };
      if (path === "/api/accounts/business-owners/me/email/") {
        if (!init?.headers?.["X-Step-Up-Token"]) throw stepUp;
        return { email: "abena@example.com", sent: true };
      }
      throw new ApiError(404, {});
    });
    const onSaved = jest.fn();
    await render(<EmailConfirmBanner goLive={missing} onSaved={onSaved} />);
    await fill("abena@example.com");
    await fireEvent.changeText(await screen.findByLabelText("Code we sent you"), "123456");
    await fireEvent.press(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Sent to abena@example.com")).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith("/api/otp/step-up/send/", { body: { action: "contact_change", channel: "sms" } });
    expect(apiMock).toHaveBeenCalledWith("/api/accounts/business-owners/me/email/", { body: { email: "abena@example.com", password: "my-password" }, headers: { "X-Step-Up-Token": "tok-1" } });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Your password")).toBeNull();
  });

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])("success_lines_for_signed_out_phone_%s_payout_cooling_%s_appear_only_when_true", async (signedOut, cooling) => {
    apiMock.mockResolvedValue({ email: "abena@example.com", sent: true, side_effects: { signed_out_phone: signedOut, payout_cooling: cooling } });
    await render(<EmailConfirmBanner goLive={missing} />);
    await fill("abena@example.com");
    expect(await screen.findByText("Sent to abena@example.com")).toBeTruthy();
    expect(screen.queryByText("You will be asked to sign in again on your phone.") !== null).toBe(signedOut);
    expect(screen.queryByText("For your safety, payout accounts wait a short cooling period again before withdrawals.") !== null).toBe(cooling);
  });

  it("a_refused_address_after_the_code_step_keeps_the_token_for_one_corrected_retry", async () => {
    const stepUp = new ApiError(403, { code: "step_up_required", action: "contact_change", detail: "Confirm it's you with a code first." });
    let verifies = 0;
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === "/api/otp/step-up/send/") return { hint: "+233 ••• 4417" };
      if (path === "/api/otp/step-up/verify/") { verifies += 1; return { step_up_token: "tok-1" }; }
      if (path === "/api/accounts/business-owners/me/email/") {
        if (!init?.headers?.["X-Step-Up-Token"]) throw stepUp;
        if (init.body.email === "taken@example.com") throw new ApiError(400, { email: ["A business owner with this email already exists."] });
        return { email: init.body.email, sent: true };
      }
      throw new ApiError(404, {});
    });
    await render(<EmailConfirmBanner goLive={missing} />);
    await fill("taken@example.com");
    await fireEvent.changeText(await screen.findByLabelText("Code we sent you"), "123456");
    await fireEvent.press(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("A business owner with this email already exists.")).toBeTruthy();
    await fill("abena@example.com");
    expect(await screen.findByText("Sent to abena@example.com")).toBeTruthy();
    expect(verifies).toBe(1);
    expect(screen.queryByLabelText("Code we sent you")).toBeNull();
  });

  it("the_kept_token_is_dropped_on_back_so_the_next_attempt_asks_for_a_code_again", async () => {
    const stepUp = new ApiError(403, { code: "step_up_required", action: "contact_change", detail: "Confirm it's you with a code first." });
    apiMock.mockImplementation(async (path: string, init?: any) => {
      if (path === "/api/otp/step-up/send/") return { hint: "+233 ••• 4417" };
      if (path === "/api/otp/step-up/verify/") return { step_up_token: "tok-1" };
      if (path === "/api/accounts/business-owners/me/email/") {
        if (!init?.headers?.["X-Step-Up-Token"]) throw stepUp;
        throw new ApiError(400, { email: ["A business owner with this email already exists."] });
      }
      throw new ApiError(404, {});
    });
    await render(<EmailConfirmBanner goLive={unconfirmed} />);
    await fireEvent.press(screen.getByRole("button", { name: "Wrong address? Change it" }));
    await fill("taken@example.com");
    await fireEvent.changeText(await screen.findByLabelText("Code we sent you"), "123456");
    await fireEvent.press(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByText("A business owner with this email already exists.");
    await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
    await fireEvent.press(screen.getByRole("button", { name: "Wrong address? Change it" }));
    await fill("other@example.com");
    expect(await screen.findByLabelText("Code we sent you")).toBeTruthy();
  });

  it("backing_out_of_the_code_step_returns_to_the_form_with_the_password_cleared", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/otp/step-up/send/") return { hint: "+233 ••• 4417" };
      throw new ApiError(403, { code: "step_up_required", action: "contact_change", detail: "Confirm it's you with a code first." });
    });
    await render(<EmailConfirmBanner goLive={missing} />);
    await fill("abena@example.com");
    await fireEvent.press(await screen.findByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Your password").props.value).toBe("");
  });

  it("unconfirmed_keeps_resend_offers_a_toggle_and_cancel_closes_the_form", async () => {
    apiMock.mockResolvedValue({ email: "new@example.com", sent: true });
    await render(<EmailConfirmBanner goLive={unconfirmed} />);
    expect(screen.getByRole("button", { name: "Resend" })).toBeTruthy();
    expect(screen.queryByLabelText("Email address")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Wrong address? Change it" }));
    await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Email address")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Wrong address? Change it" }));
    await fill("new@example.com");
    expect(await screen.findByText("Sent to new@example.com")).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith("/api/accounts/business-owners/me/email/", { body: { email: "new@example.com", password: "my-password" } });
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
