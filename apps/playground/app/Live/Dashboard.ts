import { LiveComponent } from "@bunyad/live-components";
import { render } from "@bunyad/view";

/**
 * Parent component that embeds the counter (nested Live demo).
 */
export default class Dashboard extends LiveComponent {
  title = "Nested counter";

  async html(): Promise<string> {
    return render("_components.live.dashboard", {
      title: this.title,
      counter: await this.live("counter", {}, { key: "main" }),
    });
  }
}
