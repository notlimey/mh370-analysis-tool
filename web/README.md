# Web version — deploy instructions

## GitHub Pages (recommended)

1. Go to your repo Settings → Pages
2. Set Source to "Deploy from a branch"
3. Set Branch to `main` and folder to `/web`
4. Save — your site will be live at:
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
