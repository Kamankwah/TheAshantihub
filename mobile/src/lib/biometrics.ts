import * as LocalAuthentication from "expo-local-authentication";

export const biometrics = {
  /** True when this phone has Face ID, Touch ID or a fingerprint sensor AND the person has enrolled one. */
  async available(): Promise<boolean> {
    try {
      return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
    } catch {
      return false;
    }
  },

  async prompt(reason: string): Promise<"ok" | "cancelled" | "unavailable"> {
    if (!(await biometrics.available())) return "unavailable";
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: "Use password",
    });
    return result.success ? "ok" : "cancelled";
  },
};
