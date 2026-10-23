import { onMounted, ref } from "vue";

export type Appearance = "light" | "dark" | "system";

/** Light, dark, or follow the OS. Saved per browser; `app.view` applies it before first paint. */
export function useAppearance() {
  // "system" first, as the server renders it; the saved choice is read after hydration.
  const appearance = ref<Appearance>("system");
  onMounted(() => {
    appearance.value = (localStorage.getItem("appearance") as Appearance | null) ?? "system";
  });

  const updateAppearance = (value: Appearance) => {
    localStorage.setItem("appearance", value);
    if (value === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
    appearance.value = value;
  };

  return { appearance, updateAppearance };
}
