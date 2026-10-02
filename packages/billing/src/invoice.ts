import { Billing } from "./billing.ts";

/** Stripe Invoice object (fields we use). */
export type StripeInvoice = {
  id: string;
  number?: string | null;
  status?: string | null;
  currency?: string | null;
  total?: number | null;
  amount_due?: number | null;
  customer?: string | null;
  invoice_pdf?: string | null;
  hosted_invoice_url?: string | null;
  created?: number;
  [key: string]: unknown;
};

export type InvoiceDownloadOptions = {
  vendor?: string;
  product?: string;
  street?: string;
  location?: string;
  phone?: string;
  email?: string;
  url?: string;
  companyStreet?: string;
  companyLocation?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyUrl?: string;
};

/**
 * Billing Invoice wrapper — prefers Stripe-hosted PDF URL (minimal PDF path).
 */
export class Invoice {
  constructor(readonly raw: StripeInvoice) {}

  id(): string {
    return this.raw.id;
  }

  number(): string | null {
    return this.raw.number ?? null;
  }

  status(): string | null {
    return this.raw.status ?? null;
  }

  /** Stripe-hosted PDF URL (`invoice_pdf`). */
  pdfUrl(): string | null {
    return this.raw.invoice_pdf ?? null;
  }

  /** Customer-facing hosted invoice page. */
  hostedUrl(): string | null {
    return this.raw.hosted_invoice_url ?? null;
  }

  /**
   * Returns Stripe PDF URL + suggested filename.
   * Apps can `fetch(result.url)` or redirect; no local PDF renderer required.
   */
  download(
    _data: InvoiceDownloadOptions = {},
    filename?: string,
  ): { url: string; filename: string; invoice: Invoice } {
    const url = this.pdfUrl() ?? this.hostedUrl();
    if (!url) {
      throw new Error(`Invoice [${this.id()}] has no PDF or hosted URL from Stripe.`);
    }
    const name =
      filename ??
      `${this.number() ?? this.id()}.pdf`;
    return { url, filename: name, invoice: this };
  }

  /** Fetch PDF bytes from Stripe's `invoice_pdf` URL. */
  async downloadPdf(
    data: InvoiceDownloadOptions = {},
    filename?: string,
  ): Promise<{ bytes: Uint8Array; filename: string; contentType: string }> {
    const { url, filename: name } = this.download(data, filename);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to download invoice PDF (${res.status}).`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return {
      bytes,
      filename: name,
      contentType: res.headers.get("content-type") ?? "application/pdf",
    };
  }

  asStripeInvoice(): StripeInvoice {
    return this.raw;
  }
}

export async function retrieveStripeInvoice(id: string): Promise<Invoice> {
  const raw = await Billing.stripe().request<StripeInvoice>(`/v1/invoices/${id}`);
  return new Invoice(raw);
}

export async function listStripeInvoices(
  customerId: string,
  params: { limit?: number } = {},
): Promise<Invoice[]> {
  const limit = params.limit ?? 24;
  const raw = await Billing.stripe().request<{ data: StripeInvoice[] }>(
    `/v1/invoices?customer=${encodeURIComponent(customerId)}&limit=${limit}`,
  );
  return (raw.data ?? []).map((row) => new Invoice(row));
}
