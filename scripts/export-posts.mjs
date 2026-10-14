// Read-only: exports Blog posts published on or after a date, with all their sections, as JSON.
// Usage: npm run export -- [YYYY-MM-DD] > posts.json   (default 2026-01-01)
import { getCollection, loadConfig, openProject } from "./lib.mjs"

const since = new Date(process.argv[2] ?? "2026-01-01")
const config = await loadConfig()

const framer = await openProject()
try {
    const collection = await getCollection(framer, config.collection)
    const fields = await collection.getFields()
    const byName = new Map(fields.map(f => [f.name, f]))
    const text = (item, name) => {
        const field = byName.get(name)
        const entry = field && item.fieldData[field.id]
        if (!entry || entry.value == null) return undefined
        // Reads return the case name; fall back to looking up an id just in case.
        if (field.type === "enum") return field.cases.find(c => c.id === entry.value)?.name ?? entry.value
        return entry.value
    }

    const posts = []
    for (const item of await collection.getItems()) {
        const publish = text(item, "Publish")
        if (!publish || new Date(publish) < since) continue

        const sections = []
        for (let n = 1; byName.has(`Section ${n}`); n++) {
            const title = text(item, `Section Title ${n}`)
            const body = text(item, `Section ${n}`)
            if (title || body) sections.push({ n, title, body: body && htmlToText(body) })
        }
        posts.push({
            slug: item.slug,
            title: text(item, "Title"),
            publish,
            draft: item.draft,
            tags: text(item, "Tags"),
            sections,
        })
    }
    posts.sort((a, b) => new Date(a.publish) - new Date(b.publish))
    console.log(JSON.stringify(posts, null, 2))
    console.error(`${posts.length} posts published since ${since.toISOString().slice(0, 10)}.`)
} finally {
    await framer.disconnect()
}

// Rough HTML → Markdown-ish text: keeps headings, list items and paragraphs readable.
function htmlToText(html) {
    return html
        .replace(/<h([1-6])[^>]*>/gi, (_, n) => "\n\n" + "#".repeat(Number(n)) + " ")
        .replace(/<li[^>]*>/gi, "\n- ")
        .replace(/<\/(p|h[1-6]|ul|ol|blockquote)>/gi, "\n\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"')
        .replace(/\n{3,}/g, "\n\n")
        .trim()
}
