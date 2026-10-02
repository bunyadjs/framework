import type { Middleware } from "@bunyad/http";
import { HttpException } from "@bunyad/http";
import { Feature } from "./feature.ts";

/**
 * Abort unless all listed features are active for the default scope.
 */
export function ensureFeaturesAreActive(...features: string[]): Middleware {
  return async (_request, next) => {
    if (!(await Feature.active(features))) {
      throw new HttpException(400, "Required features are not enabled.");
    }
    return next();
  };
}
