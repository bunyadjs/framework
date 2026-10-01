import { Mailable } from "@bunyad/mail";

export default class WelcomeMail extends Mailable {
  constructor(readonly email: string) {
    super();
  }

  envelope() {
    return {
      to: this.email,
      subject: "Welcome to Bunyad",
    };
  }

  content() {
    return {
      markdown: "mail.welcome",
      with: { email: this.email },
    };
  }
}
