/** Address accepted by Mail.to / Mailable.to (string or `{ email }`). */
export type MailAddress =
  | string
  | { email: string; name?: string };

export function normalizeAddresses(
  value: MailAddress | MailAddress[] | undefined | null,
): string[] {
  if (value == null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item.email === "string") return item.email;
    throw new Error("Invalid mail address.");
  });
}

export function asAddressField(
  value: string[],
): string | string[] | undefined {
  if (value.length === 0) return undefined;
  if (value.length === 1) return value[0];
  return value;
}

export function mergeAddressLists(
  ...groups: Array<string | string[] | undefined>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const addr of normalizeAddresses(group as string | string[] | undefined)) {
      if (seen.has(addr)) continue;
      seen.add(addr);
      out.push(addr);
    }
  }
  return out;
}
