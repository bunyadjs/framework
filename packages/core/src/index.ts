export {
  Application,
  app,
  setApplicationInstance,
  type Provider,
  type ApplicationOptions,
} from "./application.ts";
export {
  ApplicationBuilder,
  ExceptionsConfigurator,
  MiddlewareConfigurator,
  type RoutingOptions,
} from "./application-builder.ts";
export {
  ServiceProvider,
  type ServiceProviderClass,
} from "./service-provider.ts";
export {
  registerProviderCommand,
  getProviderCommandHandlers,
  clearProviderCommands,
  commandNameFromCtor,
  type CommandHandler,
} from "./provider-commands.ts";
export { HttpKernel, createFetchHandler, pathnameOf } from "./kernel.ts";
export {
  stampControllerConstructorInject,
  resetControllerConstructorInjectCache,
} from "./controller-constructor.ts";
export { setFormRequestAction } from "./form-request-action.ts";
export {
  invokeWithInjectPlan,
  setControllerInjectPlan,
  resolveControllerInjectPlan,
  shouldFailClosedOnMissingInjectPlan,
} from "./route-model-action.ts";
export {
  renderException,
  renderExceptionHtml,
  parseStack,
  statusFromError,
  wantsJson,
  shouldReturnJson,
  exceptionJsonPayload,
  isApplicationFrame,
  isVendorPath,
  pickEditorFrame,
  groupStackFrames,
  exceptionChain,
  queryExceptionInfo,
  type StackFrame,
  type ExceptionContext,
  type ExceptionRenderer,
  type ShouldRenderJsonWhenCallback,
  type ReportableCallback,
  type ExceptionContextCallback,
  type ExceptionType,
} from "./exception.ts";
export {
  serve,
  type ServeOptions,
  type ServeDevelopment,
  type ServeFetch,
} from "./serve.ts";
export {
  shutdownSignal,
  onShutdown,
  requestShutdown,
  installShutdownHandlers,
  resetShutdownForTests,
} from "./shutdown.ts";
export {
  startWorkers,
  resolveWorkerLaunch,
  type StartWorkersOptions,
} from "./workers.ts";
export {
  resolveAppBasePath,
  isBunEmbeddedPath,
} from "./paths.ts";
export {
  injectReloadScript,
  isHtmlResponse,
  defaultRefreshRoots,
  createDevReloadHandler,
} from "./dev-reload.ts";

export {
  isCompiledBootMode,
  compiledConfigModulePath,
  compiledConfigJsonPath,
} from "./compiled-boot.ts";

export { installGlobals } from "./globals.ts";
export { installGlobals as installCommonGlobals } from "@bunyad/common";

// HTTP / view / routing / config helpers on globalThis (+ common helpers).
import "./globals.ts";
