import { LiveComponent } from "@bunyad/live";

export default class Counter extends LiveComponent {
  count = 0;
  label = "clicks";

  increment() {
    this.count += 1;
  }

  decrement() {
    this.count -= 1;
  }

  reset() {
    this.count = 0;
  }

  view(): string {
    return "livewire.counter";
  }
}
