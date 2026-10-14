# blog-automation

Pushes Markdown posts from `posts/` into the Momos blog's Framer CMS collection as drafts. See README.md.

- Only ever create or update **drafts** (`draft: true`). Never call `framer.publish()` or `framer.deploy()`, and never modify an item that is already live. A person reviews and publishes in Framer.
- Field names live in `blog.config.json`. If a field is missing, run `npm run inspect` (read-only) instead of guessing.
- Run `npm run draft -- <post> --dry-run` before a real run.
- Needs `FRAMER_PROJECT_URL`, `FRAMER_API_KEY`, and network access to `api.framer.com`. Never ask for the API key in chat.
