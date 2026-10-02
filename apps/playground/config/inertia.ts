/** Inertia adapter config. */
export default {
  ssr: {
    /**
     * Default on for Bun inline SSR. Set `INERTIA_SSR_ENABLED=0` to disable.
     * HTTP mode still needs a running `inertia:start-ssr` process.
     */
    get enabled() {
      if (
        process.env.INERTIA_SSR_ENABLED === "0" ||
        process.env.INERTIA_SSR_ENABLED === "false"
      ) {
        return false;
      }
      if (
        process.env.INERTIA_SSR_ENABLED === "1" ||
        process.env.INERTIA_SSR_ENABLED === "true"
      ) {
        return true;
      }
      return true;
    },
    /** `inline` (same process) or `http` (remote createServer). */
    get mode(): "inline" | "http" {
      if (process.env.INERTIA_SSR_MODE === "http") return "http";
      if (process.env.INERTIA_SSR_MODE === "inline") return "inline";
      // Compiled binaries avoid embedding React SSR unless explicitly requested.
      if (process.env.BUNYAD_COMPILED === "1") return "http";
      return "inline";
    },
    get url() {
      return process.env.INERTIA_SSR_URL ?? "http://127.0.0.1:13714";
    },
    get timeout() {
      return Number(process.env.INERTIA_SSR_TIMEOUT ?? 3000);
    },
  },
};
