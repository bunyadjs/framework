import { FeatureManager } from "./manager.ts";
import { ArrayFeatureStore } from "./array-store.ts";

/**
 * Test double for `Feature.fake()` — same API as `FeatureManager` with helpers.
 */
export class FeatureFake extends FeatureManager {
  constructor() {
    super(new ArrayFeatureStore());
  }

  async assertActive(feature: string, scope: unknown = null): Promise<void> {
    if (!(await this.active(feature, scope))) {
      throw new Error(`Failed asserting that feature [${feature}] is active.`);
    }
  }

  async assertInactive(feature: string, scope: unknown = null): Promise<void> {
    if (!(await this.inactive(feature, scope))) {
      throw new Error(`Failed asserting that feature [${feature}] is inactive.`);
    }
  }
}
