import type { Request } from "@bunyad/http";
import { noContent } from "@bunyad/http";
import { Auth } from "@bunyad/auth";
import IssueTokenRequest from "@/Http/Requests/IssueTokenRequest.ts";
import TokenResource from "@/Http/Resources/TokenResource.ts";

export default class TokenController {
  /** Exchange credentials for a bearer token. */
  async store(request: IssueTokenRequest) {
    const user = await request.authenticate();
    const token = await Auth.guard("token").createToken(
      user,
      request.tokenName(),
    );

    return TokenResource.make({ token, user }).response();
  }

  /** Revoke the token used on this request. */
  async destroy(request: Request) {
    await Auth.guard("token").revoke(request);

    return noContent();
  }
}
