import { useEffect, useState } from "react";

export type Appearance = "light" | "dark" | "system";

/** Light, dark, or follow the OS. Saved per browser; `app.view` applies it before first paint. */
export function useAppearance() {
  // "system" first, as the server renders it; the saved choice is read after hydration.
  const [appearance, setAppearance] = useState<Appearance>("system");
  useEffect(() => {
    setAppearance((localStorage.getItem("appearance") as Appearance | null) ?? "system");
  }, []);

  const update = (value: Appearance) => {
    localStorage.setItem("appearance", value);
    if (value === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
    setAppearance(value);
  };

  return { appearance, updateAppearance: update };
}
