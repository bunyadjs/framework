import { Auth } from "@bunyad/auth";
import User from "@/Models/User.ts";
import RegisterRequest from "@/Http/Requests/RegisterRequest.ts";
import TokenResource from "@/Http/Resources/TokenResource.ts";

export default class RegisterController {
  async __invoke(request: RegisterRequest) {
    const user = await User.create(request.validated());

    const token = await Auth.guard("token").createToken(user, "api");

    return TokenResource.make({ token, user }).response(201);
  }
}
