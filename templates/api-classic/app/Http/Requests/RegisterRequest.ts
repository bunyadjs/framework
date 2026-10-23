import { FormRequest } from "@bunyad/http";

type Registration = { name: string; email: string; password: string };

export default class RegisterRequest extends FormRequest<Registration> {
  authorize() {
    return true;
  }

  rules() {
    return {
      name: "required|string|max:255",
      email: "required|email|max:255|unique:users,email",
      password: "required|string|min:8",
    };
  }
}
