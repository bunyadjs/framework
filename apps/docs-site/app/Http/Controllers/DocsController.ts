import type { Request } from "@bunyad/http";
import { documentFor, searchJson } from "../../Docs/cache.ts";

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export default class DocsController {
  home(): Response {
    return Response.redirect("/docs/1.x", 302);
  }

  async index(): Promise<Response> {
    const body = await documentFor("");
    return body ? html(body) : html("Not found", 404);
  }

  async show(request: Request): Promise<Response> {
    const body = await documentFor(String(request.input("slug") ?? ""));
    return body ? html(body) : html("Not found", 404);
  }

  search(): Response {
    return new Response(searchJson(), {
      headers: { "Content-Type": "application/json" },
    });
  }
}
