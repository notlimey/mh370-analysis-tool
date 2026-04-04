# Web version — deploy instructions

## GitHub Pages (recommended)

This repo includes a GitHub Actions workflow that deploys the `web/` folder directly to Pages.

1. Go to your repo Settings → Pages
2. Set Source to `GitHub Actions`
3. Push to `main` or run the `Deploy Web Snapshot` workflow manually
4. Your site will be live at:
   https://notlimey.github.io/mh370-analysis-tool

## Vercel

1. Import the repo on vercel.com
2. Set Root Directory to `web`
3. Framework Preset: Other
4. Deploy

## Local preview

```bash
cd web
python3 -m http.server 8080
# open http://localhost:8080
```

Note: must be served over HTTP, not opened as a `file://` URL,
because `fetch()` calls won't work from the filesystem.
