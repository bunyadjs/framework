import { Route } from "@bunyad/router";
import { Live } from "@bunyad/live-components";
import { Metrics } from "@bunyad/metrics";
import Note from "@/Models/Note.ts";
import Post from "@/Models/Post.ts";
import User from "@/Models/User.ts";

/** Explicit model bindings, the update endpoint and client script of the Live components, and the metrics dashboard. */
export default function (): void {
  Route.model("user", User);
  Route.model("post", Post);
  Route.model("note", Note);

  Live.routes(Route);
  Metrics.routes(Route);
}
