import { Job } from "@bunyad/queue";
import { Mail } from "@bunyad/mail";
import WelcomeMail from "@/Mail/WelcomeMail.ts";

export default class SendWelcomeEmailJob extends Job {
  constructor(readonly email: string) {
    super();
  }

  async handle(): Promise<void> {
    await Mail.send(new WelcomeMail(this.email));
  }
}
