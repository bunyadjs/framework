// The Svelte adapter is published only under the "svelte" export condition, which the server and `bun test` do not use,
// so `@inertiajs/svelte` is mapped to this file (tsconfig `paths`). Importing the adapter by path keeps its types.
export * from "../../node_modules/@inertiajs/svelte/dist/index.js";
