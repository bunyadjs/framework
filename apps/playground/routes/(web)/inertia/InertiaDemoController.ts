import { Head } from "@bunyad/head";

export default class InertiaDemoController {
  /** View: `InertiaPage.tsx`. */
  show() {
    Head.title("Inertia").description("Hello from Bunyad Inertia");
    return {
      title: "Inertia",
      message: "Hello from Bunyad",
    };
  }
}
