# @bunyad/migrate

Migration helpers for moving a PHP web project to Bunyad: scan a codebase for incompatible patterns and generate TypeScript stubs from PHP controllers, models, routes, requests, policies, migrations, middleware, jobs and templates.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add -d @bunyad/migrate@beta
# or: npm install -D @bunyad/migrate@beta
```

## Usage

```ts
import { scanPhpDirectory, formatReport, convertPhpFile } from "@bunyad/migrate";

const root = "./legacy-app";
console.log(formatReport(await scanPhpDirectory(root)));
// Bunyad migration report — /abs/path/legacy-app
// Files: 1 PHP
// Needs review: 1 file(s) with flagged patterns
//
// Issues:
//   app/Http/Controllers/PostController.php:7 [facade] PHP facades need Bunyad facade imports or helpers.
//
// Controllers:
//   app/Http/Controllers/PostController.php → PostController (index, store)

const path = "app/Http/Controllers/PostController.php";
console.log(convertPhpFile(await Bun.file(`${root}/${path}`).text(), path));
// export default class PostController {
//   async index(request: Request) { /* TODO: migrate ... */ return json({ todo: "index" }); }
//   async store(request: Request) { ... }
// }
```

The same two steps are available from the CLI:

```bash
bunyad migrate:report ./legacy-app
bunyad migrate:convert app/Http/Controllers/PostController.php
```

## Notes

- Runs on Bun only (1.4 or newer). No peer dependencies.
- `convertPhpFile` picks a converter from the file path (PHP template files become `.view` pages). Individual converters (`convertControllerStub`, `convertModelStub`, `convertRoutesStub`, ...) are exported too.
- Output is a stub with `TODO` markers, not a semantic port: method bodies are not translated.
- The scan only flags patterns it knows (for example PHP facade calls); manual review is still needed.

## License

MIT
