export default class HomeController {
  handle() {
    return { name: config<string>("app.name") };
  }
}
