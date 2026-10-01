# create-bunyad

Create a new [Bunyad](https://github.com/bunyadjs/framework) app.

> **Alpha.** APIs may change between `0.x` releases.

```bash
bun create bunyad my-app
```

You are asked for a starter kit (Views, Live, React, Vue or Svelte with Inertia, or API), a database (SQLite, PostgreSQL or MySQL), and whether to install dependencies and initialize git. Skip the questions with flags:

```bash
bun create bunyad my-app --kit=react --database=pgsql --install --git
```

Requires [Bun](https://bun.sh) 1.1 or newer.

## License

MIT
