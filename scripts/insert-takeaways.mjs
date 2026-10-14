// Adds a "Key takeaways" heading and list to the end of Section 1 (the intro) of live Blog posts.
// Nothing else moves: the blog template pins embeds (tables, "Explore further" boxes) to each section
// slot, so shifting sections would detach them from their text.
// The one script allowed to edit live posts (see CLAUDE.md). It never publishes.
//
// Usage:
//   npm run takeaways                          # dry run: show what would change, save nothing
//   npm run takeaways -- --write --only <slug> # back up, then change one post
//   npm run takeaways -- --write --all         # back up, then change every eligible post
//   npm run takeaways -- --restore backups/takeaways-<timestamp>   # put backed-up posts back
//   npm run takeaways -- --restore backups/takeaways-<timestamp> --only <slug>
//
// Takeaways come from review/key-takeaways-2026.md. Section 1's translations (fr-CA, es-ES, ja-JP) are left
// as they are; Framer marks them "needs review" because the English changed.
// --restore puts back section text and translations; translations go through setLocalizationData,
// because setAttributes doesn't change them.
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { getCollection, loadConfig, openProject } from "./lib.mjs"

const TITLE = "Key takeaways"
const REVIEW_FILE = "review/key-takeaways-2026.md"

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const write = flag("--write")
const only = option("--only")
const restoreDir = option("--restore")
if (write && !only && !flag("--all")) {
    console.error("--write needs --only <slug> or --all.")
    process.exit(1)
}

const config = await loadConfig()
const framer = await openProject()
try {
    const collection = await getCollection(framer, config.collection)
    const fields = await collection.getFields()
    const byName = new Map(fields.map(f => [f.name, f]))
    const intro = byName.get("Section 1")
    const sectionFields = fields.filter(f => /^Section( Title)? \d+$/.test(f.name))
    const findItem = async id => (await collection.getItems()).find(i => i.id === id)

    if (restoreDir) {
        await restore(restoreDir)
    } else {
        const takeaways = parseReview(await readFile(REVIEW_FILE, "utf8"))
        const plan = []
        for (const item of await collection.getItems()) {
            if (!takeaways.has(item.slug)) continue
            if (only && item.slug !== only) continue
            const reason = skipReason(item)
            if (reason) {
                console.log(`skip  ${item.slug}: ${reason}`)
                continue
            }
            plan.push(item)
        }
        if (only && plan.length === 0) throw new Error(`"${only}" isn't eligible (see above) or has no takeaways in ${REVIEW_FILE}.`)

        const backupDir = `backups/takeaways-${new Date().toISOString().replace(/[:.]/g, "-")}`
        for (const item of plan) {
            const bullets = takeaways.get(item.slug)
            console.log(`\n${write ? "write" : "would"} ${item.slug}${item.draft ? " (draft)" : ""}: append "${TITLE}" to the end of Section 1`)
            for (const b of bullets) console.log(`    - ${b}`)
            if (!write) continue

            await mkdir(backupDir, { recursive: true })
            await writeFile(path.join(backupDir, `${item.slug}.json`), JSON.stringify({ id: item.id, slug: item.slug, fieldData: item.fieldData }, null, 2))
            try {
                const value = (item.fieldData[intro.id]?.value ?? "") + takeawaysHtml(bullets)
                await save(item, { [intro.id]: entry(intro, value) })
                await verify(item.id, item.fieldData, bullets)
            } catch (error) {
                console.error(`  ${item.slug} failed: ${error.message}\n  Restoring it from the backup.`)
                await restoreItem(item.id, item.fieldData)
                throw new Error(`Stopped after ${item.slug}; it was restored. Posts before it are done.`)
            }
            console.log(`  done, verified. Backup: ${backupDir}/${item.slug}.json`)
        }
        const verb = write ? "Changed" : "Would change"
        console.log(`\n${verb} ${plan.length} post(s).${write ? "" : " Dry run: nothing was saved."}`)
    }

    function skipReason(item) {
        const title = item.fieldData[byName.get("Title").id]?.value ?? ""
        if (/^\[for archive\]/i.test(title) || /-copy$/.test(item.slug)) return "archive copy"
        for (const f of sectionFields) {
            const value = item.fieldData[f.id]?.value ?? ""
            if (/key takeaways?/i.test(f.name.startsWith("Section Title") ? value : value.replace(/<[^>]*>/g, " "))) return "already has Key takeaways"
        }
        if (/tl;?dr/i.test((item.fieldData[intro.id]?.value ?? "").slice(0, 300))) return "already opens with a TLDR"
        return null
    }

    // Re-reads the post: Section 1 ends with the takeaways, and every other section and translation is untouched.
    // Reads straight after a write can be stale for a few seconds, so it retries before failing.
    async function verify(itemId, before, bullets, attempt = 1) {
        try {
            await check(itemId, before, bullets)
        } catch (error) {
            if (attempt >= 5) throw error
            await new Promise(resolve => setTimeout(resolve, 3000 * attempt))
            await verify(itemId, before, bullets, attempt + 1)
        }
    }

    async function check(itemId, before, bullets) {
        const after = await findItem(itemId)
        const problems = []
        const text = after.fieldData[intro.id]?.value ?? ""
        const tail = text.slice(text.search(/<h3[^>]*>Key takeaways<\/h3>/i))
        if (!/<h3[^>]*>Key takeaways<\/h3>/i.test(text)) problems.push(`Section 1 has no "${TITLE}" heading`)
        if (bullets.some(b => !tail.includes(escapeHtml(b).slice(0, 20)))) problems.push("Section 1 is missing takeaways")
        const plain = html => html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()
        if (!plain(text).startsWith(plain(before[intro.id]?.value ?? ""))) problems.push("Section 1's intro text changed")
        for (const f of sectionFields.filter(f => f !== intro)) {
            const a = after.fieldData[f.id], b = before[f.id]
            if (blank(a?.value) !== blank(b?.value)) problems.push(`${f.name} changed`)
            for (const [locale, v] of Object.entries(b?.valueByLocale ?? {})) {
                if ((a?.valueByLocale?.[locale]?.value ?? null) !== (v.value ?? null)) problems.push(`${f.name} [${locale}] changed`)
            }
        }
        if (after.draft !== before.draft) problems.push("draft status changed")
        if (problems.length) throw new Error(`verification failed:\n    ${problems.slice(0, 10).join("\n    ")}`)
    }

    // Section fields and their translations exactly as backed up.
    async function restoreItem(itemId, backupFieldData) {
        const item = await findItem(itemId)
        const update = {}
        const translations = new Map()
        for (const f of sectionFields) {
            const value = backupFieldData[f.id]?.value ?? ""
            if (blank(value) !== blank(item.fieldData[f.id]?.value)) update[f.id] = entry(f, value)
            if (!sameTranslations(backupFieldData[f.id], item.fieldData[f.id])) translations.set(f.name, localeUpdate(backupFieldData[f.id], item.fieldData[f.id]))
        }
        if (Object.keys(update).length) await save(item, update)
        await applyTranslations(itemId, translations)
    }

    async function restore(dir) {
        for (const file of (await readdir(dir)).filter(f => f.endsWith(".json"))) {
            const backup = JSON.parse(await readFile(path.join(dir, file), "utf8"))
            if (only && backup.slug !== only) continue
            if (!(await findItem(backup.id))) {
                console.log(`skip  ${backup.slug}: no longer in the collection`)
                continue
            }
            await restoreItem(backup.id, backup.fieldData)
            console.log(`restored ${backup.slug}`)
        }
    }

    // Collection items' translatable fields come back from getLocalizationGroups as sources in field
    // order. Line them up and check each one's English text before writing anything.
    async function applyTranslations(itemId, translations) {
        if (translations.size === 0) return
        const item = await findItem(itemId)
        const [group] = await framer.getLocalizationGroups({ groupIds: [itemId] })
        const textFields = fields.filter(f => f.type === "string" || f.type === "formattedText")
        const textSources = group.sources.filter(s => s.type === "string" || s.type === "formattedText")
        if (textFields.length !== textSources.length) throw new Error(`${textFields.length} text fields but ${textSources.length} translation sources`)
        const valuesBySource = {}
        textFields.forEach((f, k) => {
            if (blank(textSources[k].value) !== blank(item.fieldData[f.id]?.value)) throw new Error(`translation source for ${f.name} doesn't match its English text`)
            if (translations.has(f.name)) valuesBySource[textSources[k].id] = translations.get(f.name)
        })
        const result = await framer.setLocalizationData({ valuesBySource })
        if (result.valuesBySource.errors.length) throw new Error(`translation errors: ${JSON.stringify(result.valuesBySource.errors.slice(0, 3))}`)
    }
} finally {
    await framer.disconnect()
}

function takeawaysHtml(bullets) {
    const items = bullets.map(b => `<li data-preset-tag="p"><p>${escapeHtml(b)}</p></li>`).join("")
    return `<h3>${TITLE}</h3><ul dir="auto">${items}</ul>`
}

// While two Blog posts share a translated slug, Framer rejects writes to the collection with
// "Duplicate slugs found in locale ...", sometimes after partly saving. Fix those slugs in Framer first.
async function save(item, fieldData) {
    try {
        await item.setAttributes({ fieldData })
    } catch (error) {
        if (/^Duplicate slugs found in locale/.test(error.message)) {
            error.message += "\n  Some Blog posts share a translated slug. Make them unique in Framer (CMS → the post → its French/Spanish/Japanese slug), then re-run."
        }
        throw error
    }
}

// Framer stores an emptied rich-text field as a blank paragraph, so treat that the same as "".
function blank(value) {
    return (value ?? "").replace(/^<p dir="auto"><br class="trailing-break"><\/p>$/, "")
}

function entry(field, value) {
    return field.type === "formattedText" ? { type: "formattedText", value, contentType: "html" } : { type: field.type, value }
}

// Each translation as backed up; locales with no translation ("new") are cleared.
function localeUpdate(from, current) {
    const update = {}
    for (const locale of new Set([...Object.keys(from?.valueByLocale ?? {}), ...Object.keys(current?.valueByLocale ?? {})])) {
        const v = from?.valueByLocale?.[locale]
        update[locale] = v && v.status !== "new" && v.value != null
            ? { action: "set", value: v.value, needsReview: v.status === "needsReview" }
            : { action: "clear" }
    }
    return update
}

function sameTranslations(a, b) {
    const locales = new Set([...Object.keys(a?.valueByLocale ?? {}), ...Object.keys(b?.valueByLocale ?? {})])
    return [...locales].every(l => {
        const x = a?.valueByLocale?.[l], y = b?.valueByLocale?.[l]
        return (x?.value ?? null) === (y?.value ?? null) && (x?.status ?? "new") === (y?.status ?? "new")
    })
}

// review/key-takeaways-2026.md: "## Title", "- Slug: `slug`", then the takeaway bullets.
function parseReview(text) {
    const takeaways = new Map()
    for (const block of text.split(/\n(?=## )/)) {
        const slug = block.match(/^- Slug: `([^`]+)`/m)?.[1]
        if (!slug) continue
        const bullets = block
            .split("\n")
            .filter(line => line.startsWith("- ") && !/^- (Slug|Publish|Tags):/.test(line))
            .map(line => line.slice(2).trim())
        if (bullets.length) takeaways.set(slug, bullets)
    }
    return takeaways
}

function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
