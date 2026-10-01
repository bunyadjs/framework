/**
 * SMS notification message (Vonage / generic HTTP SMS).
 */
export class SmsMessage {
  #content = "";
  #from?: string;

  content(value: string): this {
    this.#content = value;
    return this;
  }

  from(value: string): this {
    this.#from = value;
    return this;
  }

  getContent(): string {
    return this.#content;
  }

  getFrom(): string | undefined {
    return this.#from;
  }
}

/** Alias matching Laravel `VonageMessage`. */
export class VonageMessage extends SmsMessage {}
