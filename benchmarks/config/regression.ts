/**
 * CI regression gate for kept suites only (framework + ORM compares).
 *
 * Threshold: 10% is a placeholder until variance is observed on CI hardware.
 * Soft-fail (warn, exit 0) is the default when baselines are missing.
 */
export type RegressionConfig = {
  maxRegressionPercent: number;
  defaultMode: "soft" | "strict";
  suites: string[];
};

const regressionConfig: RegressionConfig = {
  maxRegressionPercent: 10,
  defaultMode: "soft",
  suites: ["competitors", "orm-compare"],
};

export default regressionConfig;
