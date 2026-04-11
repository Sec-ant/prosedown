import { useSyncExternalStore } from "react";

const systemDarkQuery =
  typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : undefined;

function subscribeSystemDark(callback: () => void) {
  systemDarkQuery?.addEventListener("change", callback);
  return () => systemDarkQuery?.removeEventListener("change", callback);
}

function getSystemDark() {
  return systemDarkQuery?.matches ?? false;
}

export function useSystemDark() {
  return useSyncExternalStore(subscribeSystemDark, getSystemDark, () => false);
}
