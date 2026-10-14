// Inserts a "Key takeaways" section into live Blog posts and moves every later section down one place.
// The one script allowed to edit live posts (see CLAUDE.md). It never publishes.
//
// Usage:
//   npm run takeaways                          # dry run: show what would change, save nothing
//   npm run takeaways -- --write --only <slug> # back up, then change one post
//   npm run takeaways -- --write --all         # back up, then change every eligible post
//   npm run takeaways -- --translations-only --only <slug>   # redo just the translation move, from the post's latest backup
//   npm run takeaways -- --restore backups/takeaways-<timestamp>   # put backed-up posts back
//
// Takeaways come from review/key-takeaways-2026.md. Translations (fr-CA, es-ES, ja-JP) move with their
// section through setLocalizationData (setAttributes doesn't move them); the new section has none.
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { getCollection, loadConfig, openProject } from "./lib.mjs"

const TITLE = "Key takeaways"
const INSERT_AT = 2 // after the untitled intro in Section 1
const REVIEW_FILE = "review/key-takeaways-2026.md"

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const write = flag("--write")
const translationsOnly = flag("--translations-only")
const only = option("--only")
const restoreDir = option("--restore")
if ((write && !only && !flag("--all")) || (translationsOnly && !only)) {
    console.error("--write needs --only <slug> or --all; --translations-only needs --only <slug>.")
    process.exit(1)
}

const config = await loadConfig()
const framer = await openProject()
try {
    const collection = await getCollection(framer, config.collection)
    const fields = await collection.getFields()
    const byName = new Map(fields.map(f => [f.name, f]))
    let last = 0
    while (byName.has(`Section ${last + 1}`)) last++
    const slot = n => [byName.get(`Section Title ${n}`), byName.get(`Section ${n}`)]
    const sectionFields = fields.filter(f => /^Section( Title)? \d+$/.test(f.name))
    const findItem = async id => (await collection.getItems()).find(i => i.id === id)

    if (restoreDir) {
        await restore(restoreDir)
    } else if (translationsOnly) {
        const backup = await latestBackup(only)
        const item = (await collection.getItems()).find(i => i.slug === only)
        console.log(`translations for ${only}, from ${backup.file}`)
        await applyTranslations(item.id, shiftedTranslations(backup.fieldData))
        await verify(item.id, backup.fieldData, null)
        console.log("  done, verified.")
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
            const used = usedSlots(item)
            console.log(`\n${write ? "write" : "would"} ${item.slug}${item.draft ? " (draft)" : ""}`)
            console.log(`  S${INSERT_AT}..S${used.at(-1)} → S${INSERT_AT + 1}..S${used.at(-1) + 1}; new S${INSERT_AT} "${TITLE}":`)
            for (const b of bullets) console.log(`    - ${b}`)
            if (!write) continue

            await mkdir(backupDir, { recursive: true })
            await writeFile(path.join(backupDir, `${item.slug}.json`), JSON.stringify({ id: item.id, slug: item.slug, fieldData: item.fieldData }, null, 2))
            try {
                await item.setAttributes({ fieldData: shiftedFieldData(item.fieldData, bullets) })
                await applyTranslations(item.id, shiftedTranslations(item.fieldData))
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
        const [lastTitle, lastBody] = slot(last).map(f => item.fieldData[f.id])
        if (hasContent(lastTitle) || hasContent(lastBody)) return `Section ${last} is in use, so there's no room to shift`
        const title = item.fieldData[byName.get("Title").id]?.value ?? ""
        if (/^\[for archive\]/i.test(title) || /-copy$/.test(item.slug)) return "archive copy"
        for (let n = 1; n <= last; n++) {
            const [t, b] = slot(n).map(f => item.fieldData[f.id]?.value ?? "")
            if (/^key takeaways?$/i.test(t.trim())) return "already has a Key takeaways section"
            if (n <= 2 && /tl;?dr|key takeaways?/i.test(b.slice(0, 300))) return "already opens with a TLDR"
        }
        return null
    }

    function usedSlots(item) {
        const used = []
        for (let n = 1; n <= last; n++) if (slot(n).some(f => hasContent(item.fieldData[f.id]))) used.push(n)
        return used
    }

    // English values for slots INSERT_AT..last: slot n gets what was in n-1, slot INSERT_AT gets the takeaways.
    function shiftedFieldData(before, bullets) {
        const update = {}
        for (let n = last; n > INSERT_AT; n--) {
            slot(n).forEach((to, k) => {
                const value = before[slot(n - 1)[k].id]?.value ?? ""
                if (value !== (before[to.id]?.value ?? "")) update[to.id] = entry(to, value)
            })
        }
        const [title, body] = slot(INSERT_AT)
        update[title.id] = entry(title, TITLE)
        update[body.id] = entry(body, `<ul dir="auto">${bullets.map(b => `<li data-preset-tag="p"><p>${escapeHtml(b)}</p></li>`).join("")}</ul>`)
        return update
    }

    // Translations for the same slots, keyed by field name: slot n gets n-1's, slot INSERT_AT is cleared.
    function shiftedTranslations(before) {
        const translations = new Map()
        for (let n = last; n >= INSERT_AT; n--) {
            slot(n).forEach((to, k) => {
                const from = n > INSERT_AT ? before[slot(n - 1)[k].id] : undefined
                if (!hasTranslations(from) && !hasTranslations(before[to.id])) return
                translations.set(to.name, localeUpdate(from, before[to.id]))
            })
        }
        return translations
    }

    // Collection items' translatable fields come back from getLocalizationGroups as sources in field
    // order. Line them up and check each one's English value before writing anything.
    async function applyTranslations(itemId, translations) {
        if (translations.size === 0) return
        const item = await findItem(itemId)
        const [group] = await framer.getLocalizationGroups({ groupIds: [itemId] })
        const textFields = fields.filter(f => f.type === "string" || f.type === "formattedText")
        const textSources = group.sources.filter(s => s.type === "string" || s.type === "formattedText")
        if (textFields.length !== textSources.length) throw new Error(`${textFields.length} text fields but ${textSources.length} translation sources`)
        const valuesBySource = {}
        textFields.forEach((f, k) => {
            if ((textSources[k].value ?? "") !== (item.fieldData[f.id]?.value ?? "")) throw new Error(`translation source for ${f.name} doesn't match its English text`)
            if (translations.has(f.name)) valuesBySource[textSources[k].id] = translations.get(f.name)
        })
        const result = await framer.setLocalizationData({ valuesBySource })
        if (result.valuesBySource.errors.length) throw new Error(`translation errors: ${JSON.stringify(result.valuesBySource.errors.slice(0, 3))}`)
    }

    // Re-reads the post and checks every moved section and its translations landed one slot down.
    async function verify(itemId, before, bullets) {
        const after = await findItem(itemId)
        const problems = []
        for (let n = last; n > INSERT_AT; n--) {
            slot(n).forEach((to, k) => {
                const from = slot(n - 1)[k], a = after.fieldData[to.id], b = before[from.id]
                if ((a?.value ?? "") !== (b?.value ?? "")) problems.push(`${to.name} doesn't match the old ${from.name}`)
                for (const [locale, v] of Object.entries(b?.valueByLocale ?? {})) {
                    const got = a?.valueByLocale?.[locale]
                    const want = v.status === "new" ? null : v.value
                    if ((got?.status === "new" ? null : got?.value ?? null) !== (want ?? null)) problems.push(`${to.name} [${locale}] doesn't match the old ${from.name}`)
                }
            })
        }
        const [title, body] = slot(INSERT_AT)
        if (after.fieldData[title.id]?.value !== TITLE) problems.push(`Section Title ${INSERT_AT} isn't "${TITLE}"`)
        if (bullets && bullets.some(b => !(after.fieldData[body.id]?.value ?? "").includes(escapeHtml(b).slice(0, 20)))) problems.push(`Section ${INSERT_AT} is missing takeaways`)
        for (const f of slot(INSERT_AT)) {
            if (Object.values(after.fieldData[f.id]?.valueByLocale ?? {}).some(v => v.status !== "new")) problems.push(`${f.name} still has old translations`)
        }
        if (problems.length) throw new Error(`verification failed:\n    ${problems.slice(0, 10).join("\n    ")}`)
    }

    // Section fields and their translations exactly as backed up.
    async function restoreItem(itemId, backupFieldData) {
        const current = (await findItem(itemId)).fieldData
        const update = {}
        const translations = new Map()
        for (const f of sectionFields) {
            const value = backupFieldData[f.id]?.value ?? ""
            if (value !== (current[f.id]?.value ?? "")) update[f.id] = entry(f, value)
            if (hasTranslations(backupFieldData[f.id]) || hasTranslations(current[f.id])) translations.set(f.name, localeUpdate(backupFieldData[f.id], current[f.id]))
        }
        const item = await findItem(itemId)
        if (Object.keys(update).length) await item.setAttributes({ fieldData: update })
        await applyTranslations(itemId, translations)
    }

    async function restore(dir) {
        for (const file of (await readdir(dir)).filter(f => f.endsWith(".json"))) {
            const backup = JSON.parse(await readFile(path.join(dir, file), "utf8"))
            if (!(await findItem(backup.id))) {
                console.log(`skip  ${backup.slug}: no longer in the collection`)
                continue
            }
            await restoreItem(backup.id, backup.fieldData)
            console.log(`restored ${backup.slug}`)
        }
    }
} finally {
    await framer.disconnect()
}

async function latestBackup(slug) {
    const dirs = (await readdir("backups")).filter(d => d.startsWith("takeaways-")).sort().reverse()
    for (const dir of dirs) {
        const file = path.join("backups", dir, `${slug}.json`)
        try {
            return { file, fieldData: JSON.parse(await readFile(file, "utf8")).fieldData }
        } catch {}
    }
    throw new Error(`No backup for ${slug} in backups/.`)
}

function entry(field, value) {
    return field.type === "formattedText" ? { type: "formattedText", value, contentType: "html" } : { type: field.type, value }
}

// Carries each translation across as-is; locales with no translation ("new") are cleared.
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

function hasTranslations(entry) {
    return Object.values(entry?.valueByLocale ?? {}).some(v => v.status !== "new")
}

// A blank rich-text field is often stored as `<p dir="auto"><br class="trailing-break"></p>`.
function hasContent(entry) {
    const visible = v => typeof v === "string" && (/<(img|iframe|table|video)/i.test(v) || v.replace(/<[^>]*>|&nbsp;|\s/g, "") !== "")
    return visible(entry?.value) || Object.values(entry?.valueByLocale ?? {}).some(v => visible(v.value))
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
