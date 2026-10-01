/**
 * Install HTTP / view / routing / config helpers on `globalThis`
 * (controllers and views can call them without importing).
 */
import "@bunyad/common/globals";
import { config } from "@bunyad/config";
import {
  abort,
  abort_if,
  abort_unless,
  json,
  redirect,
  response,
  to_route,
} from "@bunyad/http";
import { action, asset, route, url } from "@bunyad/router";
import { validate, validator } from "@bunyad/validation";
import { render, view } from "@bunyad/view";
import { app } from "./application.ts";

export type BunyadCoreGlobalHelpers = {
  app: typeof app;
  config: typeof config;
  abort: typeof abort;
  abort_if: typeof abort_if;
  abort_unless: typeof abort_unless;
  redirect: typeof redirect;
  to_route: typeof to_route;
  response: typeof response;
  json: typeof json;
  view: typeof view;
  render: typeof render;
  route: typeof route;
  url: typeof url;
  asset: typeof asset;
  action: typeof action;
  validator: typeof validator;
  validate: typeof validate;
};

let installed = false;

/** Idempotent — safe to call from multiple entrypoints. */
export function installGlobals(): void {
  if (installed) return;
  installed = true;
  const g = globalThis as typeof globalThis &
    Partial<BunyadCoreGlobalHelpers>;
  g.app = app;
  g.config = config;
  g.abort = abort;
  g.abort_if = abort_if;
  g.abort_unless = abort_unless;
  g.redirect = redirect;
  g.to_route = to_route;
  g.response = response;
  g.json = json;
  g.view = view;
  g.render = render;
  g.route = route;
  g.url = url;
  g.asset = asset;
  g.action = action;
  g.validator = validator;
  g.validate = validate;
}

declare global {
  function app(): import("./application.ts").Application;
  function config<T = unknown>(key: string, defaultValue?: T): T;
  function abort(
    status: number,
    message?: string,
    headers?: Record<string, string>,
  ): never;
  function abort_if(
    condition: unknown,
    status: number,
    message?: string,
    headers?: Record<string, string>,
  ): void;
  function abort_unless(
    condition: unknown,
    status: number,
    message?: string,
    headers?: Record<string, string>,
  ): void;
  function redirect(): import("@bunyad/http").Redirector;
  function redirect(
    to: string,
    status?: number,
    headers?: Record<string, string>,
  ): Response;
  function to_route(
    name: string,
    params?: Record<string, unknown>,
    status?: number,
    headers?: Record<string, string>,
  ): Response;
  const response: import("@bunyad/http").ResponseFactory;
  function json(data: unknown, status?: number): Response;
  function view(
    name: string,
    data?: Record<string, unknown>,
    status?: number,
  ): Response;
  function render(
    name: string,
    data?: Record<string, unknown>,
  ): string;
  function route(
    name: string,
    params?: Record<string, import("@bunyad/router").RouteParamValue>,
    absolute?: boolean,
  ): string;
  function url(): import("@bunyad/router").UrlFacade;
  function url(path: string): string;
  function asset(path: string, secure?: boolean | null): string;
  function action(
    target: [new () => object, string] | (new () => object),
    params?: Record<string, import("@bunyad/router").RouteParamValue>,
    absolute?: boolean,
  ): string;
  function validator(
    data: Record<string, unknown>,
    rulesMap: import("@bunyad/validation").Rules,
  ): import("@bunyad/validation").Validator;
  function validate(
    data: Record<string, unknown>,
    ruleMap: import("@bunyad/validation").Rules,
    options?: import("@bunyad/validation").ValidateOptions,
  ): Promise<Record<string, unknown>>;
}

installGlobals();
