/**
 * Change a response's headers in place when it allows that (anything built with `new Response`),
 * and copy it only when it does not (`fetch()` results, `Response.redirect()`). Every middleware
 * that adds headers uses this, so a response is copied at most once however many of them run.
 */
export function withHeaders(response: Response, change: (headers: Headers) => void): Response {
  try {
    change(response.headers);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    change(headers);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
