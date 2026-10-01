import type { Request } from "@bunyad/http";
import { json } from "@bunyad/http";
import { Feature } from "@bunyad/features";
import { Auth } from "@bunyad/auth";

export default class FeatureDemoController {
  async index(request: Request) {
    const user = await Auth().user(request);
    const scope = user ?? null;

    return json({
      "new-api": await Feature.for(scope).active("new-api"),
      "purchase-button": await Feature.for(scope).value("purchase-button"),
      "beta-dashboard": await Feature.for(scope).active("beta-dashboard"),
    });
  }
}
