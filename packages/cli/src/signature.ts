export type SignatureArgument = {
  name: string;
  optional: boolean;
  array: boolean;
  default?: string;
};

export type SignatureOption = {
  name: string;
  shortcut?: string;
  acceptsValue: boolean;
  default?: string;
};

export type ParsedSignature = {
  name: string;
  arguments: SignatureArgument[];
  options: SignatureOption[];
};

export type BoundInput = {
  arguments: Record<string, string | string[] | undefined>;
  options: Record<string, string | boolean | undefined>;
};

/** Parse `mail:send {user} {--queue}`. */
export function parseSignature(signature: string): ParsedSignature {
  const trimmed = signature.trim();
  const brace = trimmed.search(/\s*\{/);
  const name = (brace === -1 ? trimmed : trimmed.slice(0, brace)).trim();
  const rest = brace === -1 ? "" : trimmed.slice(brace);
  const arguments_: SignatureArgument[] = [];
  const options: SignatureOption[] = [];

  for (const match of rest.matchAll(/\{([^}]+)\}/g)) {
    const token = stripDescription(match[1] ?? "").trim();
    if (!token) continue;
    if (token.startsWith("--") || /^\w\|--/.test(token) || token.includes("|--")) {
      options.push(parseOptionToken(token));
    } else {
      arguments_.push(parseArgumentToken(token));
    }
  }

  return { name, arguments: arguments_, options };
}

export function bindSignatureInput(
  signature: ParsedSignature,
  argv: string[],
): BoundInput {
  const arguments_: Record<string, string | string[] | undefined> = {};
  const options: Record<string, string | boolean | undefined> = {};

  for (const argument of signature.arguments) {
    arguments_[argument.name] = argument.array
      ? []
      : argument.default;
  }
  for (const option of signature.options) {
    options[option.name] = option.acceptsValue
      ? option.default
      : false;
  }

  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      const rawName = eq === -1 ? token.slice(2) : token.slice(2, eq);
      const option = findOption(signature, rawName);
      if (!option) {
        continue;
      }
      if (!option.acceptsValue) {
        options[option.name] = true;
        continue;
      }
      const value = eq === -1 ? argv[++i] : token.slice(eq + 1);
      options[option.name] = value;
      continue;
    }
    if (token.startsWith("-") && token.length === 2) {
      const option = findOption(signature, token.slice(1));
      if (!option) {
        continue;
      }
      if (!option.acceptsValue) {
        options[option.name] = true;
        continue;
      }
      options[option.name] = argv[++i];
      continue;
    }
    positional.push(token);
  }

  let offset = 0;
  for (const argument of signature.arguments) {
    if (argument.array) {
      arguments_[argument.name] = positional.slice(offset);
      offset = positional.length;
      break;
    }
    if (offset < positional.length) {
      arguments_[argument.name] = positional[offset];
      offset += 1;
    }
  }

  return { arguments: arguments_, options };
}

function stripDescription(token: string): string {
  const colon = token.indexOf(" : ");
  return colon === -1 ? token : token.slice(0, colon);
}

function parseArgumentToken(token: string): SignatureArgument {
  let name = token;
  let optional = false;
  let array = false;
  let defaultValue: string | undefined;
  if (name.endsWith("*")) {
    array = true;
    optional = true;
    name = name.slice(0, -1);
  } else if (name.endsWith("?")) {
    optional = true;
    name = name.slice(0, -1);
  } else if (name.includes("=")) {
    optional = true;
    const at = name.indexOf("=");
    defaultValue = name.slice(at + 1);
    name = name.slice(0, at);
  }
  return { name, optional, array, default: defaultValue };
}

function parseOptionToken(token: string): SignatureOption {
  let body = token.startsWith("--") ? token.slice(2) : token;
  let shortcut: string | undefined;
  if (body.includes("|")) {
    const [left, right] = body.split("|", 2) as [string, string];
    if (left.startsWith("--")) {
      body = left.slice(2);
      shortcut = right.replace(/^--/, "");
    } else if (right.startsWith("--")) {
      shortcut = left;
      body = right.slice(2);
    } else if (left.length === 1) {
      shortcut = left;
      body = right.replace(/^--/, "");
    } else {
      body = left.replace(/^--/, "");
      shortcut = right;
    }
  }

  let acceptsValue = false;
  let defaultValue: string | undefined;
  if (body.endsWith("=")) {
    acceptsValue = true;
    body = body.slice(0, -1);
  } else if (body.includes("=")) {
    acceptsValue = true;
    const at = body.indexOf("=");
    defaultValue = body.slice(at + 1);
    body = body.slice(0, at);
  }

  return { name: body, shortcut, acceptsValue, default: defaultValue };
}

function findOption(
  signature: ParsedSignature,
  name: string,
): SignatureOption | undefined {
  return signature.options.find(
    (option) => option.name === name || option.shortcut === name,
  );
}
