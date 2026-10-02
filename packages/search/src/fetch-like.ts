/** Minimal fetch signature, so tests and apps can pass a simple mock. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
