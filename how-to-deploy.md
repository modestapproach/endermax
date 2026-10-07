# How to Deploy Endermax

The site is hosted on **Cloudflare Pages** (project name `endermax`), which serves
endermax.com. Deploys are manual uploads of the `dist` folder via wrangler.

## 1. Build the project

Always rebuild so `dist` has the latest changes (includes `/portfolio.html`, the case-study page):

```bash
npm run build
```

## 2. Log in (only if needed)

Wrangler's OAuth token expires periodically. If the deploy says "Not logged in":

```bash
npx wrangler login
```

## 3. Deploy to production

**Important:** `--branch master` is required — the Cloudflare Pages project treats
`master` as the production branch; any other branch name deploys to a preview URL.

```bash
npx wrangler pages deploy dist --project-name endermax --branch master
```

Requires Node.js v20+ (`nvm use 20` if needed).

## Server environment variables

The AI proxies in `functions/api/` need these set in the Cloudflare Pages project
settings (Settings → Environment variables), **not** in any committed file:

- `OPENAI_API_KEY` — used by `/api/summary` (GPT-4o) and `/api/transcribe` (Whisper)
- `ELEVENLABS_API_KEY` — used by `/api/tts`

`.env` and `.dev.vars` are for local dev only and are gitignored. **The keys that
were committed to git history before the v3 hygiene pass should be rotated.**

## Troubleshooting

- Old version showing → make sure you ran `npm run build` first.
- Site at a `...pages.dev` preview URL instead of endermax.com → you forgot `--branch master`.
- AI summary/transcribe/TTS failing in production → check the env vars above in the
  Cloudflare dashboard.
