import { ServiceProvider } from "@bunyad/core";
import { Dispatcher, setEventDispatcher } from "@bunyad/events";

/**
 * Default event dispatcher so `Event.listen` / `event()` work without
 * constructing one in the application provider.
 */
export class EventServiceProvider extends ServiceProvider {
  register(): void {
    setEventDispatcher(new Dispatcher({ container: this.app }));
  }
}
