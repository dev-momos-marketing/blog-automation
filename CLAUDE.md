# blog-automation

Pushes Markdown posts from `posts/` into the Momos blog's Framer CMS collection as drafts. See README.md.

- Only ever create or update **drafts** (`draft: true`). Never call `framer.publish()` or `framer.deploy()`, and never modify an item that is already live. A person reviews and publishes in Framer.
  - Two exceptions, approved by the blog owner. Never extend either to other edits:
    - `scripts/insert-takeaways.mjs` may edit live Blog posts, only to append a "Key takeaways" heading and list to the end of Section 1. It backs up each post first (`backups/`) and can `--restore`. Don't move sections: the template pins embeds to each section slot.
    - `scripts/fix-translated-slugs.mjs` (one-off) gives 11 posts that shared a translated slug their own slug, as listed in it. It backs up the old slugs and can `--restore`.
- Field names live in `blog.config.json`. If a field is missing, run `npm run inspect` (read-only) instead of guessing.
- Run `npm run draft -- <post> --dry-run` before a real run.
- Needs `FRAMER_PROJECT_URL`, `FRAMER_API_KEY`, and network access to `api.framer.com`. Never ask for the API key in chat.
