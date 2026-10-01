import { Route } from "@bunyad/router";
import DocsController from "../app/Http/Controllers/DocsController.ts";

export default function (): void {
  Route.get("/", [DocsController, "home"]);
  Route.get("/docs/1.x", [DocsController, "index"]);
  Route.get("/docs/1.x/{slug}", [DocsController, "show"]);
  Route.get("/assets/search-index.json", [DocsController, "search"]);
}
