export type DocPage = {
  slug: string;
  title: string;
  file: string;
};

export type DocGroup = {
  title: string;
  pages: DocPage[];
};

export type DocVersion = {
  id: string;
  label: string;
  latest: boolean;
};

export const versions: DocVersion[] = [
  { id: "1.x", label: "1.x", latest: true },
];

export const currentVersion = versions.find((version) => version.latest)!;

/** Sidebar order. Empty groups stay out until a page exists. */
export const nav: DocGroup[] = [
  {
    title: "Getting Started",
    pages: [
      { slug: "", title: "Introduction", file: "index.md" },
      { slug: "installation", title: "Installation", file: "installation.md" },
      { slug: "configuration", title: "Configuration", file: "configuration.md" },
      { slug: "structure", title: "Directory Structure", file: "structure.md" },
      { slug: "standalone", title: "Using Packages Alone", file: "standalone.md" },
    ],
  },
  {
    title: "Architecture Concepts",
    pages: [
      { slug: "lifecycle", title: "Request Lifecycle", file: "lifecycle.md" },
      { slug: "container", title: "Service Container", file: "container.md" },
      { slug: "providers", title: "Service Providers", file: "providers.md" },
      { slug: "compiler", title: "The Compiler", file: "compiler.md" },
    ],
  },
  {
    title: "The Basics",
    pages: [
      { slug: "routing", title: "Routing", file: "routing.md" },
      { slug: "middleware", title: "Middleware", file: "middleware.md" },
      { slug: "csrf", title: "CSRF Protection", file: "csrf.md" },
      { slug: "controllers", title: "Controllers", file: "controllers.md" },
      { slug: "requests", title: "Requests", file: "requests.md" },
      { slug: "responses", title: "Responses", file: "responses.md" },
      { slug: "views", title: "Views", file: "views.md" },
      { slug: "urls", title: "URL Generation", file: "urls.md" },
      { slug: "validation", title: "Validation", file: "validation.md" },
      { slug: "session", title: "Session", file: "session.md" },
      { slug: "errors", title: "Error Handling", file: "errors.md" },
      { slug: "logging", title: "Logging", file: "logging.md" },
    ],
  },
  {
    title: "Frontend",
    pages: [
      { slug: "live", title: "Live", file: "live.md" },
      { slug: "inertia", title: "Inertia", file: "inertia.md" },
    ],
  },
  {
    title: "Digging Deeper",
    pages: [
      { slug: "console", title: "Console", file: "console.md" },
      { slug: "broadcasting", title: "Broadcasting", file: "broadcasting.md" },
      { slug: "cache", title: "Cache", file: "cache.md" },
      { slug: "collections", title: "Collections", file: "collections.md" },
      { slug: "concurrency", title: "Concurrency", file: "concurrency.md" },
      { slug: "events", title: "Events", file: "events.md" },
      { slug: "filesystem", title: "File Storage", file: "filesystem.md" },
      { slug: "helpers", title: "Helpers", file: "helpers.md" },
      { slug: "images", title: "Image Manipulation", file: "images.md" },
      { slug: "mail", title: "Mail", file: "mail.md" },
      { slug: "notifications", title: "Notifications", file: "notifications.md" },
      { slug: "queues", title: "Queues", file: "queues.md" },
      { slug: "rate-limiting", title: "Rate Limiting", file: "rate-limiting.md" },
      { slug: "scheduling", title: "Task Scheduling", file: "scheduling.md" },
      { slug: "packages", title: "Package Development", file: "packages.md" },
    ],
  },
  {
    title: "Security",
    pages: [
      { slug: "authentication", title: "Authentication", file: "authentication.md" },
      { slug: "authorization", title: "Authorization", file: "authorization.md" },
      { slug: "verification", title: "Email Verification", file: "verification.md" },
      { slug: "two-factor", title: "Two-Factor Authentication", file: "two-factor.md" },
      { slug: "encryption", title: "Encryption", file: "encryption.md" },
      { slug: "hashing", title: "Hashing", file: "hashing.md" },
      { slug: "passwords", title: "Password Reset", file: "passwords.md" },
    ],
  },
  {
    title: "Database",
    pages: [
      { slug: "database", title: "Database: Getting Started", file: "database.md" },
      { slug: "queries", title: "Query Builder", file: "queries.md" },
      { slug: "pagination", title: "Pagination", file: "pagination.md" },
      { slug: "migrations", title: "Migrations", file: "migrations.md" },
      { slug: "seeding", title: "Seeding", file: "seeding.md" },
    ],
  },
  {
    title: "ORM",
    pages: [
      { slug: "orm", title: "ORM: Getting Started", file: "orm.md" },
      { slug: "orm-outside", title: "Using the ORM Outside Bunyad", file: "orm-outside.md" },
      { slug: "orm-relationships", title: "Relationships", file: "orm-relationships.md" },
      { slug: "orm-collections", title: "ORM Collections", file: "orm-collections.md" },
      { slug: "orm-mutators", title: "Mutators and Casting", file: "orm-mutators.md" },
      { slug: "orm-resources", title: "API Resources", file: "orm-resources.md" },
      { slug: "orm-serialization", title: "Serialization", file: "orm-serialization.md" },
      { slug: "orm-factories", title: "Factories", file: "orm-factories.md" },
      { slug: "orm-from-eloquent", title: "Coming from Eloquent", file: "orm-from-eloquent.md" },
      { slug: "orm-from-lucid", title: "Coming from Lucid", file: "orm-from-lucid.md" },
    ],
  },
  {
    title: "Testing",
    pages: [
      { slug: "testing", title: "Testing: Getting Started", file: "testing.md" },
      { slug: "http-tests", title: "HTTP Tests", file: "http-tests.md" },
      { slug: "console-tests", title: "Console Tests", file: "console-tests.md" },
      { slug: "database-testing", title: "Database Testing", file: "database-testing.md" },
      { slug: "mocking", title: "Mocking", file: "mocking.md" },
    ],
  },
  {
    title: "Developer Tools",
    pages: [
      { slug: "debugbar", title: "Debug Bar", file: "debugbar.md" },
      { slug: "mcp", title: "MCP Server", file: "mcp.md" },
    ],
  },
  {
    title: "Performance",
    pages: [
      { slug: "performance", title: "Benchmarks", file: "performance.md" },
    ],
  },
];

export function pagePath(version: string, slug: string): string {
  return slug ? `/docs/${version}/${slug}` : `/docs/${version}`;
}

export function flatPages(): Array<DocPage & { group: string }> {
  return nav.flatMap((group) =>
    group.pages.map((page) => ({ ...page, group: group.title })),
  );
}
