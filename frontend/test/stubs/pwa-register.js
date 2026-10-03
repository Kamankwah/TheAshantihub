// Vitest stand-in for vite-plugin-pwa's `virtual:pwa-register` (the plugin is
// disabled under Vitest — see vite.config.js). Tests that exercise the update
// flow inject their own register function into startStaffPwa instead.
export function registerSW() {
  return () => Promise.resolve()
}
