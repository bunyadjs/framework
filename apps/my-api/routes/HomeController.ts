import appConfig from "../config/app.ts";

export default class HomeController {
  handle() {
    return { name: appConfig.name };
  }
}
