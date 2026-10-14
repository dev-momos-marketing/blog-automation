// Saves a Markdown post into the blog collection as a draft. Never publishes.
// Usage: npm run draft -- posts/my-post.md [--dry-run]
import { readFile } from "node:fs/promises"
import path from "node:path"
import { parse as parseYaml } from "yaml"
import { getCollection, loadConfig, openProject } from "./lib.mjs"

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const postPath = args.find(a => !a.startsWith("--"))
if (!postPath) {
    console.error("Usage: npm run draft -- posts/my-post.md [--dry-run]")
    process.exit(1)
}

const config = await loadConfig()
const { frontmatter, content } = splitFrontmatter(await readFile(postPath, "utf8"))
if (!frontmatter.title) throw new Error(`${postPath} needs a "title" in its frontmatter.`)
const slug = frontmatter.slug ?? slugify(frontmatter.title)

const framer = await openProject()
try {
    const collection = await getCollection(framer, config.collection)
    if (collection.managedBy !== "user") {
        throw new Error(`"${collection.name}" is managed by a plugin, so it can't be edited here.`)
    }

    const fieldsByName = new Map((await collection.getFields()).map(f => [f.name, f]))
    const fieldData = {}
    for (const [key, fieldName] of Object.entries(config.fields)) {
        const value = key === "body" ? content.trim() : frontmatter[key]
        if (value === undefined || value === "") continue

        const field = fieldsByName.get(fieldName)
        if (!field) {
            throw new Error(`blog.config.json maps "${key}" to "${fieldName}", but "${collection.name}" has no such field. Run npm run inspect.`)
        }
        fieldData[field.id] = await toFieldEntry(field, value)
    }

    // Only ever touch drafts: a slug that's already live is edited in Framer by a person.
    const existing = (await collection.getItems()).find(i => i.slug === slug)
    if (existing && !existing.draft) {
        throw new Error(`"${slug}" is already live on the blog. Edit it in Framer instead.`)
    }

    const item = existing
        ? { id: existing.id, slug, draft: true, fieldData }
        : { slug, draft: true, fieldData }

    if (dryRun) {
        console.log(JSON.stringify(item, null, 2))
        console.log(`\nDry run: nothing was saved. Would ${existing ? "update" : "create"} draft "${slug}".`)
    } else {
        await collection.addItems([item])
        console.log(`${existing ? "Updated" : "Created"} draft "${frontmatter.title}" (${slug}) in ${collection.name}.`)
        console.log(`Review and publish it in Framer: ${process.env.FRAMER_PROJECT_URL}`)
    }
} finally {
    await framer.disconnect()
}

async function toFieldEntry(field, value) {
    switch (field.type) {
        case "string":
            return { type: "string", value: String(value) }
        case "formattedText":
            return { type: "formattedText", value: String(value), contentType: "markdown" }
        case "link":
            return { type: "link", value: String(value) }
        case "number":
            return { type: "number", value: Number(value) }
        case "boolean":
            return { type: "boolean", value: Boolean(value) }
        case "date":
            return { type: "date", value: new Date(value).toISOString() }
        case "enum": {
            const match = field.cases.find(c => c.name.toLowerCase() === String(value).toLowerCase())
            if (!match) {
                throw new Error(`"${value}" isn't an option for ${field.name}. Options: ${field.cases.map(c => c.name).join(", ")}`)
            }
            return { type: "enum", value: match.id }
        }
        case "image": {
            // Either a URL / path, or { src, alt }.
            const { src, alt } = typeof value === "object" ? value : { src: value, alt: frontmatter.title }
            return { type: "image", value: await imageUrl(src), alt }
        }
        default:
            throw new Error(`${field.name} is a "${field.type}" field, which draft-post.mjs doesn't fill in yet.`)
    }
}

// Remote images go in as-is; local ones (relative to the post) are uploaded to Framer first.
async function imageUrl(src) {
    if (/^https?:\/\//.test(src)) return src
    if (dryRun) return `(would upload ${src})`

    const file = path.resolve(path.dirname(postPath), src)
    const ext = path.extname(file).slice(1).toLowerCase()
    const mimeType = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" }[ext]
    if (!mimeType) throw new Error(`Can't upload ${src}: use a .jpg, .png, .webp, .gif or .svg.`)

    const bytes = new Uint8Array(await readFile(file))
    const asset = await framer.uploadImage({ image: { bytes, mimeType }, name: path.basename(file) })
    return asset.url
}

function splitFrontmatter(text) {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
    if (!match) throw new Error(`${postPath} should start with a --- frontmatter block.`)
    return { frontmatter: parseYaml(match[1]) ?? {}, content: match[2] }
}

function slugify(text) {
    return text
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
}
