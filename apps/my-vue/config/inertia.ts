/**
 * Server-side rendering: the first visit to a page gets HTML rendered by
 * `bootstrap/inertia-ssr.ts` in this process, then the browser hydrates it.
 * Set `INERTIA_SSR_ENABLED=0` to render in the browser only.
 */
export default {
  ssr: {
    enabled: !["0", "false"].includes(process.env.INERTIA_SSR_ENABLED ?? ""),
    mode: "inline" as const,
  },
};
