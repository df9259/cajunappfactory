# Cajun App Factory site

Source for the pages on cajunappfactory.com.

- `/` company page (`index.html`)
- `/privacy/` company privacy policy (`privacy/index.html`)
- `/stopscope/*` and `/mystops/*` 301 via `_redirects`

The web bot is `GROK-BOT.md`. Paste that file and say `run site`.

Cloudflare deploys `main` with an empty build command and `npx wrangler deploy`. Custom domain: cajunappfactory.com.
