import { FormRequest } from "@bunyad/http";

export default class RegisterRequest extends FormRequest {
  authorize() {
    return true;
  }

  rules() {
    return {
      name: "required|string|min:2",
      email: "required|email|unique:users,email",
      password: "required|string|min:4",
    };
  }
}
