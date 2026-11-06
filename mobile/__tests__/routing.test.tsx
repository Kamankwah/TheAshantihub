import { render, screen } from "@testing-library/react-native";

import { BUSINESS_TABS, canEnter, CUSTOMER_TABS, routeFor } from "../src/lib/routing";
import { ComingSoon } from "../src/ui/ComingSoon";

describe("role routing", () => {
  it("signed_out_redirects_to_welcome", () => {
    expect(routeFor("signedOut")).toBe("/welcome");
    expect(canEnter("customer", "signedOut")).toBe(false);
    expect(canEnter("business", "signedOut")).toBe(false);
  });

  it("each_account_type_lands_in_its_own_area", () => {
    expect(routeFor("signedIn", "customer")).toBe("/customer/home");
    expect(routeFor("signedIn", "business_owner")).toBe("/business/home");
  });

  it("an_unfinished_business_registration_resumes_where_it_stopped", () => {
    expect(routeFor("signedIn", "business_owner", { registrationStep: "payment_info", kycStatus: "pending" })).toBe("/register/payout");
    // A finished sign-up lands on the home screen, which shows the checklist; it never waits behind a screen for staff approval.
    expect(routeFor("signedIn", "business_owner", { registrationStep: "complete", kycStatus: "pending" })).toBe("/business/home");
    expect(routeFor("signedIn", "business_owner", { registrationStep: "complete", kycStatus: "rejected" })).toBe("/business/home");
    expect(routeFor("signedIn", "business_owner", { registrationStep: "complete", kycStatus: "verified" })).toBe("/business/home");
  });

  it("business_account_deep_linking_to_customer_route_is_redirected", () => {
    expect(canEnter("customer", "signedIn", "business_owner")).toBe(false);
    expect(canEnter("business", "signedIn", "customer")).toBe(false);
    expect(canEnter("customer", "signedIn", "customer")).toBe(true);
    expect(canEnter("business", "signedIn", "business_owner")).toBe(true);
  });

  it("customer_tabs_have_five_labelled_items", () => {
    expect(CUSTOMER_TABS.map((t) => t.label)).toEqual(["Home", "Explore", "Orders", "Wallet", "Account"]);
    expect(CUSTOMER_TABS.every((t) => t.icon)).toBe(true);
  });

  it("business_tabs_have_five_labelled_items", () => {
    expect(BUSINESS_TABS.map((t) => t.label)).toEqual(["Home", "Orders", "Listings", "Money", "More"]);
  });

  it("wallet_and_money_say_coming_soon", async () => {
    await render(<ComingSoon title="Wallet" />);
    expect(screen.getByText("This arrives in an update.")).toBeTruthy();
  });
});
