import { create } from "zustand";

import { setUpgradeHandler } from "../lib/api";

type UpdateState = {
  required: boolean;
  minVersion?: string;
  storeUrl?: string;
  require: (notice: { minVersion?: string; storeUrl?: string }) => void;
};

/** Set once the server says this build is too old (426 upgrade_required); the gate then replaces the app. */
export const useUpdate = create<UpdateState>((set) => ({
  required: false,
  minVersion: undefined,
  storeUrl: undefined,
  require: ({ minVersion, storeUrl }) => set({ required: true, minVersion, storeUrl }),
}));

setUpgradeHandler((notice) => useUpdate.getState().require(notice));
