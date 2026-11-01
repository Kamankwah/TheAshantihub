/** The API this build talks to (staging until the owner promotes; see eas.json). */
export const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://api-test.theashantihub.com").replace(/\/$/, "");
