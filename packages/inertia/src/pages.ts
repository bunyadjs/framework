import type { AlwaysProp, DeferProp, LazyProp, MergeProp, OnceProp, OptionalProp, ScrollProp } from "./props.ts";

/**
 * Page components and their props, by name. Empty until the app generates it
 * (`bunyad types:generate` writes it from the page components' props); then
 * `Inertia.render("settings/profile", { … })` checks the name and the props.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Pages {}

/** A page name: any string until the app's pages are generated. */
export type PageName = [keyof Pages] extends [never] ? string : keyof Pages & string;

/** A prop as a controller passes it: the value, a closure, or a lazy / deferred / merge / once / scroll wrapper. */
type PropInput<T> = T | (() => T | Promise<T>) | LazyProp | OptionalProp | DeferProp | AlwaysProp | MergeProp | OnceProp | ScrollProp;

/** The props a controller passes to page `N`. Unknown pages take any props. */
export type PagePropsInput<N extends string> = N extends keyof Pages
  ? { [K in keyof Pages[N]]: PropInput<Pages[N][K]> }
  : Record<string, unknown>;

/** Props may be left out when the page needs none. */
export type PagePropsArgs<N extends string> = {} extends PagePropsInput<N>
  ? [props?: PagePropsInput<N>]
  : [props: PagePropsInput<N>];
