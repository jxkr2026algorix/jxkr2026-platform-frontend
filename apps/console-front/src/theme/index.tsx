import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { z } from "zod";

const sidebarThemeSchema = z.enum(["light", "dark"]);
const sidebarThemeStorageKey = "salgil-console-sidebar-theme";

export type SidebarTheme = z.infer<typeof sidebarThemeSchema>;

type SidebarThemeContextValue = {
  readonly sidebarTheme: SidebarTheme;
  readonly toggleSidebarTheme: () => void;
};

const SidebarThemeContext = createContext<SidebarThemeContextValue | null>(
  null,
);

class MissingSidebarThemeProviderError extends Error {
  constructor() {
    super("useSidebarTheme must be used inside SidebarThemeProvider");
    this.name = "MissingSidebarThemeProviderError";
  }
}

function getInitialSidebarTheme(): SidebarTheme {
  const storedTheme = sidebarThemeSchema.safeParse(
    window.localStorage.getItem(sidebarThemeStorageKey),
  );
  if (storedTheme.success) return storedTheme.data;
  return "dark";
}

export function SidebarThemeProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [sidebarTheme, setSidebarTheme] = useState<SidebarTheme>(
    getInitialSidebarTheme,
  );

  const toggleSidebarTheme = useCallback(() => {
    setSidebarTheme((currentTheme) => {
      const nextTheme = currentTheme === "dark" ? "light" : "dark";
      window.localStorage.setItem(sidebarThemeStorageKey, nextTheme);
      return nextTheme;
    });
  }, []);

  const value = useMemo<SidebarThemeContextValue>(
    () => ({ sidebarTheme, toggleSidebarTheme }),
    [sidebarTheme, toggleSidebarTheme],
  );

  return (
    <SidebarThemeContext.Provider value={value}>
      {children}
    </SidebarThemeContext.Provider>
  );
}

export function useSidebarTheme(): SidebarThemeContextValue {
  const context = useContext(SidebarThemeContext);
  if (!context) throw new MissingSidebarThemeProviderError();
  return context;
}
