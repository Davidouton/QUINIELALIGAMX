"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type DevModeContextValue = {
  enabled: boolean;
  toggle: () => void;
};

const DevModeContext = createContext<DevModeContextValue>({ enabled: false, toggle: () => undefined });
const STORAGE_KEY = "quinielon-dev-mode";

export function DevModeProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(window.localStorage.getItem(STORAGE_KEY) === "on");
  }, []);

  function toggle() {
    setEnabled((current) => {
      const next = !current;
      window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
      return next;
    });
  }

  return <DevModeContext.Provider value={{ enabled, toggle }}>{children}</DevModeContext.Provider>;
}

export function useDevMode() {
  return useContext(DevModeContext);
}

export function DevOnly({ children }: { children: ReactNode }) {
  const { enabled } = useDevMode();
  return enabled ? children : null;
}
