import { MailMessage, Notification } from "@bunyad/notifications";

/** Password reset link mail sent by the default password broker. */
export class ResetPassword extends Notification {
  constructor(
    readonly token: string,
    readonly url: string,
    readonly expire = 60,
  ) {
    super();
  }

  toMail(): MailMessage {
    return new MailMessage()
      .subject("Reset Password Notification")
      .line("You are receiving this email because we received a password reset request for your account.")
      .action("Reset Password", this.url)
      .line(`This password reset link will expire in ${this.expire} minutes.`)
      .line("If you did not request a password reset, no further action is required.");
  }
}

/** Signed verification link mail sent after registration. */
export class VerifyEmail extends Notification {
  constructor(readonly url: string) {
    super();
  }

  toMail(): MailMessage {
    return new MailMessage()
      .subject("Verify Email Address")
      .line("Please click the button below to verify your email address.")
      .action("Verify Email Address", this.url)
      .line("If you did not create an account, no further action is required.");
  }
}
