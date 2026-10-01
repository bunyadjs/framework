import { resolve } from "node:path";
import {
  convertPhpFile,
  formatReport,
  scanPhpDirectory,
} from "@bunyad/migrate";

export async function migrateReport(args: string[]): Promise<void> {
  const target = resolve(process.cwd(), args[0] ?? ".");
  const report = await scanPhpDirectory(target);
  console.log(formatReport(report));
}

export async function migrateConvert(args: string[]): Promise<void> {
  const input = args[0];
  if (!input) {
    console.error(
      "Usage: bunyad migrate:convert <path/to/file.php|file.blade.php>",
    );
    process.exitCode = 1;
    return;
  }

  const path = resolve(process.cwd(), input);
  const source = await Bun.file(path).text();
  console.log(convertPhpFile(source, input));
}
