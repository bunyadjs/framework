export type Appearance = "light" | "dark" | "system";

/** Light, dark, or follow the OS. Saved per browser; `app.view` applies it before first paint. */
// "system" first, as the server renders it; `loadAppearance()` reads the saved choice in the browser.
export const appearance = $state<{ value: Appearance }>({ value: "system" });

export function loadAppearance() {
  appearance.value = (localStorage.getItem("appearance") as Appearance | null) ?? "system";
}

export function updateAppearance(value: Appearance) {
  localStorage.setItem("appearance", value);
  if (value === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = value;
  appearance.value = value;
}
