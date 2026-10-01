export type MailViewRenderer = (
  name: string,
  data: Record<string, unknown>,
) => string;

let viewRenderer: MailViewRenderer | undefined;

export function setMailViewRenderer(renderer: MailViewRenderer): void {
  viewRenderer = renderer;
}

export function getMailViewRenderer(): MailViewRenderer | undefined {
  return viewRenderer;
}

export function renderMailView(
  name: string,
  data: Record<string, unknown> = {},
): string {
  if (!viewRenderer) {
    throw new Error(
      "Mail view renderer is not configured. Call setMailViewRenderer() in bootstrap.",
    );
  }
  return viewRenderer(name, data);
}
