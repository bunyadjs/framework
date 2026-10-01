import { FormRequest, json } from "@bunyad/http";

export class InlineStoreRequest extends FormRequest {
  authorize() {
    return true;
  }

  rules() {
    return { title: "required|string" };
  }
}

export class InlineFormController {
  async store(request: InlineStoreRequest) {
    return json({ title: request.validated("title") });
  }
}
