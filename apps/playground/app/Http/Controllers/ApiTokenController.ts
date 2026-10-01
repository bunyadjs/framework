import type { Request } from "@bunyad/http";
import { json } from "@bunyad/http";
import { Auth, Hash } from "@bunyad/auth";
import User from "../../Models/User.ts";
import UserResource from "../Resources/UserResource.ts";

export default class ApiTokenController {
  /** Exchange credentials for a personal access token. */
  async store(request: Request) {
    const data = await request.validate({
      email: "required|email",
      password: "required|string|min:4",
    });

    const user = await User.where("email", String(data.email)).first();
    if (!user?.password) {
      return json({ message: "Invalid credentials." }, 401);
    }

    const ok = await Hash.check(String(data.password), String(user.password));
    if (!ok) {
      return json({ message: "Invalid credentials." }, 401);
    }

    const tokenName =
      typeof request.input("name") === "string"
        ? String(request.input("name"))
        : "api";
    const token = await Auth.guard("token").createToken(user, tokenName);

    return json({
      token,
      token_type: "Bearer",
      user: UserResource.make(user).toArray(),
    });
  }

  async me(request: Request) {
    const user = (await Auth.guard("token").user(request))!;
    return UserResource.make(user as User).response();
  }

  async destroy(request: Request) {
    await Auth.guard("token").revoke(request);
    return json({ revoked: true });
  }
}
