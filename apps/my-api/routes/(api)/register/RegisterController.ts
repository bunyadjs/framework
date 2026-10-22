import { Method, Middleware } from "@bunyad/http";
import { Auth } from "@bunyad/auth";
import User from "@/Models/User.ts";
import RegisterRequest from "./RegisterRequest.ts";
import TokenResource from "@/Http/Resources/TokenResource.ts";

@Method("POST")
@Middleware("throttle:tokens")
export default class RegisterController {
  async handle(request: RegisterRequest) {
    const user = await User.create(request.validated());

    const token = await Auth.guard("token").createToken(user, "api");

    return TokenResource.make({ token, user }).response(201);
  }
}
