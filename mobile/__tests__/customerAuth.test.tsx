import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";

import CustomerSignIn from "../src/app/(auth)/customer-sign-in";
import CustomerSignUp from "../src/app/(auth)/customer-sign-up";
import { api, ApiError } from "../src/lib/api";
import { useAuth } from "../src/state/auth";

jest.mock("expo-router", () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  Link: ({ children }: any) => children,
}));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
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
const loginBody = { token: "t", refresh_token: "r", account_type: "customer", id: 7, full_name: "Ama Owusu" };

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.setState({ status: "signedOut", account: undefined });
});

async function fillSignIn(identifier = "+233241234567", password = "s3cret-pass") {
  await fireEvent.changeText(screen.getByLabelText("Phone or email"), identifier);
  await fireEvent.changeText(screen.getByLabelText("Password"), password);
}

describe("customer sign in", () => {
  it("sign_in_success_stores_session_and_routes_home", async () => {
    apiMock.mockResolvedValueOnce(loginBody);
    await render(<CustomerSignIn />);
    await fillSignIn();
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(useAuth.getState().status).toBe("signedIn"));
    expect(useAuth.getState().account).toMatchObject({ type: "customer", id: 7 });
    expect(router.replace).toHaveBeenCalledWith("/");
    expect(apiMock).toHaveBeenCalledWith(
      "/api/accounts/customers/login/",
      expect.objectContaining({ auth: false, body: { identifier: "+233241234567", password: "s3cret-pass" } }),
    );
  });

  it("challenge_response_navigates_to_otp", async () => {
    apiMock.mockResolvedValueOnce({ otp_required: true, mfa_token: "mfa-1", channels: ["sms"] });
    await render(<CustomerSignIn />);
    await fillSignIn();
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith({ pathname: "/otp", params: { mfa_token: "mfa-1", channels: "sms" } }),
    );
    expect(useAuth.getState().status).toBe("signedOut");
  });

  it("wrong_password_shows_error_under_field", async () => {
    apiMock.mockRejectedValueOnce(new ApiError(400, { non_field_errors: ["Invalid credentials"] }));
    await render(<CustomerSignIn />);
    await fillSignIn();
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("That phone, email or password is not right.")).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

async function fillSignUp() {
  await fireEvent.changeText(screen.getByLabelText("Full name"), "Ama Owusu");
  await fireEvent.changeText(screen.getByLabelText("Mobile number"), "241234567");
  await fireEvent.changeText(screen.getByLabelText("Password"), "s3cret-pass");
}

describe("customer sign up", () => {
  it("sign_up_requires_terms_checkbox", async () => {
    await render(<CustomerSignUp />);
    await fillSignUp();
    await fireEvent.press(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Please accept the Terms and Privacy Policy to continue.")).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("marketing_consent_defaults_false_and_is_not_sent", async () => {
    apiMock.mockResolvedValueOnce({ id: 7, full_name: "Ama Owusu", token: "t", refresh_token: "r" });
    await render(<CustomerSignUp />);
    expect(screen.getByRole("checkbox", { name: /marketing/i }).props.accessibilityState.checked).toBe(false);
    await fillSignUp();
    await fireEvent.press(screen.getByRole("checkbox", { name: /Terms/i }));
    await fireEvent.press(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    const body = apiMock.mock.calls[0][1].body;
    expect(body).toMatchObject({ full_name: "Ama Owusu", phone: "+233241234567", password: "s3cret-pass" });
    expect(body).not.toHaveProperty("marketing_consent");
  });

  it("ticked_marketing_consent_is_sent", async () => {
    apiMock.mockResolvedValueOnce({ id: 7, full_name: "Ama Owusu", token: "t", refresh_token: "r" });
    await render(<CustomerSignUp />);
    await fillSignUp();
    await fireEvent.press(screen.getByRole("checkbox", { name: /Terms/i }));
    await fireEvent.press(screen.getByRole("checkbox", { name: /marketing/i }));
    await fireEvent.press(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(apiMock.mock.calls[0][1].body.marketing_consent).toEqual({ sms: true, email: true });
  });

  it("sign_up_with_a_code_owed_goes_to_otp", async () => {
    apiMock.mockResolvedValueOnce({ id: 7, otp_required: true, mfa_token: "mfa-2", channels: ["sms"] });
    await render(<CustomerSignUp />);
    await fillSignUp();
    await fireEvent.press(screen.getByRole("checkbox", { name: /Terms/i }));
    await fireEvent.press(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(useAuth.getState().status).toBe("signedOut");
  });
});
