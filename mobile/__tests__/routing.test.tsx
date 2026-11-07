import { BUSINESS_TABS, canEnter, CUSTOMER_TABS, guardRedirect, routeFor } from "../src/lib/routing";

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

  it("guards_account_screens_for_guests_and_business_screens_for_customers", () => {
    expect(guardRedirect(["checkout"], "signedOut")).toBe("/welcome");
    expect(guardRedirect(["manage", "new-listing"], "signedOut")).toBe("/welcome");
    expect(guardRedirect(["order", "[id]"], "signedOut")).toBe("/welcome");
    expect(guardRedirect(["manage", "hours"], "signedIn", "customer")).toBe("/customer/home");
    expect(guardRedirect(["manage", "hours"], "signedIn", "business_owner")).toBeNull();
    expect(guardRedirect(["checkout"], "signedIn", "customer")).toBeNull();
  });

  it("lets_guests_browse_and_never_redirects_while_the_session_is_unknown", () => {
    expect(guardRedirect(["listing", "[id]"], "signedOut")).toBeNull();
    expect(guardRedirect(["(auth)", "welcome"], "signedOut")).toBeNull();
    expect(guardRedirect(["legal", "[doc]"], "signedOut")).toBeNull();
    expect(guardRedirect(["checkout"], "loading")).toBeNull();
    expect(guardRedirect(["checkout"], "offline")).toBeNull();
    expect(guardRedirect([], "signedOut")).toBeNull();
  });
});
