export { ArrayMailer } from "./array-mailer.ts";
export { LogMailer } from "./log-mailer.ts";
export { SmtpMailer, formatMime, type SmtpMailerOptions } from "./smtp-mailer.ts";
export { ResendMailer, type ResendMailerOptions } from "./resend-mailer.ts";
export { PostmarkMailer, type PostmarkMailerOptions } from "./postmark-mailer.ts";
export { MailgunMailer, type MailgunMailerOptions } from "./mailgun-mailer.ts";
export { SesMailer, type SesMailerOptions } from "./ses-mailer.ts";
export { FailoverMailer } from "./failover-mailer.ts";
export { RoundRobinMailer } from "./round-robin-mailer.ts";
export { Mail, MailFake } from "./mail-fake.ts";
export { PendingMail } from "./pending-mail.ts";
export {
  asAddressField,
  mergeAddressLists,
  normalizeAddresses,
  type MailAddress,
} from "./addresses.ts";
export {
  Mailable,
  setMailer,
  getMailer,
  setMailQueue,
  getMailQueue,
  setMailStorage,
  registerMailable,
  registerMailer,
  getNamedMailer,
  clearNamedMailers,
  hasNamedMailer,
  applyAlwaysDefaults,
  alwaysFromAddress,
  alwaysToAddress,
  alwaysReplyToAddress,
  alwaysReturnPathAddress,
  SEND_QUEUED_MAILABLE,
  type MailableContent,
  type MailableEnvelope,
  type MailQueue,
  type MailStorage,
  type ShouldQueue,
  type MailableConstructor,
  type QueuedMailablePayload,
} from "./mailable.ts";
export { markdownToHtml } from "./markdown.ts";
export {
  setMailMarkdownDefaults,
  getMailMarkdownDefaults,
  renderNotificationMailHtml,
  renderMarkdownMail,
  renderMailLayout,
  renderMailButton,
  renderMailHeader,
  renderMailFooter,
  renderMailSubcopy,
  escapeMailHtml,
  DEFAULT_THEME_CSS,
  type MailButtonColor,
  type MailMarkdownDefaults,
  type NotificationMailContent,
} from "./theme.ts";
export {
  setMailViewRenderer,
  getMailViewRenderer,
  renderMailView,
  type MailViewRenderer,
} from "./view-renderer.ts";
