import { Route, type Router } from "@bunyad/router";
import HomeController from "@/Http/Controllers/HomeController.ts";

export default function (router: Router = Route): void {
  Route.get("/", HomeController).name("root");
}
