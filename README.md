# blog-automation

Write a Momos blog post as a Markdown file and save it into the Framer CMS as a **draft**. Nothing here publishes: someone opens the draft in Framer, checks it, and publishes it there.

Uses Framer's [Server API](https://www.framer.com/developers/server-api-introduction) (`framer-api` on npm).

## Setup

You need Node 22 or newer and two values:

| Variable | Where to get it |
| --- | --- |
| `FRAMER_PROJECT_URL` | The URL of the momos.com project in Framer, e.g. `https://framer.com/projects/Momos--aabbccdd1122` |
| `FRAMER_API_KEY` | In that project: Cmd+K → "open settings" → **API Keys** → create a key |

On your machine, export them in your shell. In a Claude Code cloud session, add them to the environment's settings (cloud environment menu → Edit), and allow `api.framer.com` under Network access. The API talks to `wss://api.framer.com/channel/headless-plugin`.

```bash
npm install
```

## 1. Check the blog's fields (once)

```bash
npm run inspect
```

This only reads. It lists every CMS collection with its fields and types. Then open `blog.config.json` and make it match:

- `collection`: the blog collection's exact name.
- `fields`: frontmatter key → Framer field name. `body` is special: it's the Markdown under the frontmatter.

The names in `blog.config.json` right now are guesses (`Blog`, `Title`, `Content`…) until someone runs `inspect` against the real project.

## 2. Write a post

Copy `posts/example-post.md`. Frontmatter keys are the ones in `blog.config.json`. `title` is required. `slug` is optional and comes from the title if you leave it out.

`cover` (or any image field) can be a URL, a path to an image next to the post (it gets uploaded to Framer), or `{ src, alt }`.

## 3. Save it as a draft

```bash
npm run draft -- posts/my-post.md --dry-run   # show what would be sent, save nothing
npm run draft -- posts/my-post.md
```

- New slug → creates a draft.
- Slug that's already a draft → updates that draft, so you can re-run after edits.
- Slug that's already live → stops. Change live posts in Framer.

Then open the project in Framer, review the draft in the CMS, and publish from there.

Supported field types: plain text, formatted text (from Markdown), link, number, toggle, date, option (by its name), image. References to other collections (authors, tags) aren't filled in yet.
