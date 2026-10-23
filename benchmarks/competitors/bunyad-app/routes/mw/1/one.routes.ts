import type { Middleware } from "@bunyad/http";

const noop: Middleware = (_request, next) => next();

export default { use: [noop] };
