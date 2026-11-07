import { focusManager, QueryClient } from "@tanstack/react-query";
import { AppState } from "react-native";

// React Native has no window focus: tell React Query when the app is in the foreground, so the 20-60 s polling of orders and
// support messages stops while the app is in the background instead of burning battery and the support API's hourly limit (MOB-15).
focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener("change", (state) => handleFocus(state === "active"));
  return () => sub.remove();
});

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});
