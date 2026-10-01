import { ServiceProvider } from "@bunyad/core";
import { Head, shareHeadWithInertia } from "@bunyad/head";
import { Inertia } from "@bunyad/inertia";
import { setHeadRenderer } from "@bunyad/view";

/**
 * Live `@head` rendering and share page-managed tags with Inertia.
 * Site defaults still belong in the application provider.
 */
export class HeadServiceProvider extends ServiceProvider {
  boot(): void {
    setHeadRenderer(() => Head.toHtml());
    shareHeadWithInertia(Inertia.share);
  }
}
