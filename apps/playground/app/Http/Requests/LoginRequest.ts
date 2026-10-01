import { FormRequest } from "@bunyad/http";

export default class LoginRequest extends FormRequest {
  authorize() {
    return true;
  }

  rules() {
    return {
      email: "required|email",
      password: "required|string|min:4",
    };
  }
}
