# Karl dashboard (web/)

Live counters, recent listings and a QR code to text Karl. Separate Next.js app.

## Run
```
cd web
npm install
cp .env.example .env.local   # then fill in values
npm run dev                  # http://localhost:3001
```
`npm run build && npm start` runs the production build on port 3001.

## Env vars
- `NEXT_PUBLIC_API_URL`: Karl server base URL. The page polls `<url>/api/stats` every 5 s. If unset, or until the first good response, it shows `mock-stats.json` with a "demo data" badge; after that a failed poll keeps the last live data. Relative `photoUrl`s like `/photos/abc` are loaded from this host.
- `NEXT_PUBLIC_KARL_NUMBER`: phone number shown with the QR code. Unset shows "(coming soon)".

The server must allow CORS from the dashboard origin.

## Deploy (Vercel)
Import the repo, set **Root Directory** to `web/`, add the two env vars, deploy.

`lib/types.ts` mirrors `src/types.ts` (Stats); update both if the contract changes.
