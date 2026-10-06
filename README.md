# Cajun App Factory site

Source for the pages on cajunappfactory.com.

- `/` company page
- `/privacy/` company privacy policy
- `/stopscope/` StopScope app page
- `/stopscope/privacy/` StopScope privacy policy for the Play listing
- `/mystops/` and `/mystops/privacy/` redirect to the StopScope pages

The web bot is `GROK-BOT.md`. Paste that file and say `run site`.

Cloudflare deploys `main` with an empty build command and `npx wrangler deploy`. Custom domain: cajunappfactory.com.
