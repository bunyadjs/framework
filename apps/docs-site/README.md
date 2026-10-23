# Docs site

The site follows the application layout: `app/` (the docs renderer), `config/`, and `routes/`. Pages are markdown in `content/1.x`.

```bash
cd apps/docs-site
bun run dev
```

Open [http://localhost:4321](http://localhost:4321). `bun run build` writes static files to `dist/`.
