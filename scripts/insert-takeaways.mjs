// Inserts a "Key takeaways" section into live Blog posts and moves every later section down one place.
// The one script allowed to edit live posts (see CLAUDE.md). It never publishes.
//
// Usage:
//   npm run takeaways                          # dry run: show what would change, save nothing
//   npm run takeaways -- --write --only <slug> # back up, then change one post
//   npm run takeaways -- --write --all         # back up, then change every eligible post
//   npm run takeaways -- --restore backups/takeaways-<timestamp>   # put backed-up posts back
//
// Takeaways come from review/key-takeaways-2026.md. Translations (fr-CA, es-ES, ja-JP) move with
// their section; the new section has none, so Framer shows it as untranslated.
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
    let last = 0
    while (byName.has(`Section ${last + 1}`)) last++
    const slot = n => [byName.get(`Section Title ${n}`), byName.get(`Section ${n}`)]

    if (restoreDir) {
        await restore(collection, fields, restoreDir)
    } else {
        const takeaways = parseReview(await readFile(REVIEW_FILE, "utf8"))
        const items = await collection.getItems()
        const plan = []
        for (const item of items) {
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
            const update = shiftedFieldData(item, bullets)
            const used = usedSlots(item)
            console.log(`\n${write ? "write" : "would"} ${item.slug}${item.draft ? " (draft)" : ""}`)
            console.log(`  S${INSERT_AT}..S${used.at(-1)} → S${INSERT_AT + 1}..S${used.at(-1) + 1}; new S${INSERT_AT} "${TITLE}":`)
            for (const b of bullets) console.log(`    - ${b}`)
            if (!write) continue

            await mkdir(backupDir, { recursive: true })
            await writeFile(path.join(backupDir, `${item.slug}.json`), JSON.stringify({ id: item.id, slug: item.slug, fieldData: item.fieldData }, null, 2))
            await item.setAttributes({ fieldData: update })
            await verify(collection, item, bullets)
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

    // Field data for slots INSERT_AT..last: slot n gets what was in n-1, slot INSERT_AT gets the takeaways.
    function shiftedFieldData(item, bullets) {
        const update = {}
        for (let n = last; n > INSERT_AT; n--) {
            const [toTitle, toBody] = slot(n)
            const [fromTitle, fromBody] = slot(n - 1)
            copyEntry(update, toTitle, item.fieldData[fromTitle.id], item.fieldData[toTitle.id])
            copyEntry(update, toBody, item.fieldData[fromBody.id], item.fieldData[toBody.id])
        }
        const [title, body] = slot(INSERT_AT)
        const html = `<ul dir="auto">${bullets.map(b => `<li data-preset-tag="p"><p>${escapeHtml(b)}</p></li>`).join("")}</ul>`
        update[title.id] = { type: "string", value: TITLE, valueByLocale: clearLocales(item.fieldData[title.id]) }
        update[body.id] = { type: "formattedText", value: html, contentType: "html", valueByLocale: clearLocales(item.fieldData[body.id]) }
        return update
    }

    // Re-reads the post and checks every moved section (and its translations) landed one slot down.
    async function verify(collection, before, bullets) {
        const after = (await collection.getItems()).find(i => i.id === before.id)
        const problems = []
        for (let n = last; n > INSERT_AT; n--) {
            for (const [to, from] of slot(n).map((f, k) => [f, slot(n - 1)[k]])) {
                const a = after.fieldData[to.id], b = before.fieldData[from.id]
                if ((a?.value ?? "") !== (b?.value ?? "")) problems.push(`${to.name} doesn't match the old ${from.name}`)
                for (const [locale, v] of Object.entries(b?.valueByLocale ?? {})) {
                    if ((after.fieldData[to.id]?.valueByLocale?.[locale]?.value ?? null) !== (v.value ?? null)) {
                        problems.push(`${to.name} [${locale}] doesn't match the old ${from.name}`)
                    }
                }
            }
        }
        const [title, body] = slot(INSERT_AT)
        if (after.fieldData[title.id]?.value !== TITLE) problems.push(`Section Title ${INSERT_AT} isn't "${TITLE}"`)
        const text = after.fieldData[body.id]?.value ?? ""
        if (bullets.some(b => !text.includes(escapeHtml(b).slice(0, 20)))) problems.push(`Section ${INSERT_AT} is missing takeaways`)
        if (after.draft !== before.draft) problems.push("draft status changed")
        if (problems.length) {
            console.error(`  verification failed for ${before.slug}:\n    ${problems.slice(0, 10).join("\n    ")}`)
            console.error(`  Restoring it from the backup.`)
            await after.setAttributes({ fieldData: restoreData(fields, before.fieldData) })
            throw new Error(`Stopped after ${before.slug}; it was restored. Nothing else was changed.`)
        }
    }
} finally {
    await framer.disconnect()
}

async function restore(collection, fields, dir) {
    const items = new Map((await collection.getItems()).map(i => [i.id, i]))
    for (const file of (await readdir(dir)).filter(f => f.endsWith(".json"))) {
        const backup = JSON.parse(await readFile(path.join(dir, file), "utf8"))
        const item = items.get(backup.id)
        if (!item) {
            console.log(`skip  ${backup.slug}: no longer in the collection`)
            continue
        }
        await item.setAttributes({ fieldData: restoreData(fields, backup.fieldData) })
        console.log(`restored ${backup.slug}`)
    }
}

// Section fields only, exactly as backed up (including translations).
function restoreData(fields, fieldData) {
    const update = {}
    for (const f of fields.filter(f => /^Section( Title)? \d+$/.test(f.name))) {
        copyEntry(update, f, fieldData[f.id], undefined, true)
    }
    return update
}

function copyEntry(update, to, from, current, always = false) {
    const value = from?.value ?? ""
    const same = (current?.value ?? "") === value && sameLocales(current, from)
    if (same && !always) return
    update[to.id] = {
        type: to.type,
        value,
        ...(to.type === "formattedText" ? { contentType: "html" } : {}),
        valueByLocale: localeUpdate(from, current),
    }
}

// Carries each translation across as-is; locales with no translation ("new") are cleared.
function localeUpdate(from, current) {
    const update = {}
    const locales = new Set([...Object.keys(from?.valueByLocale ?? {}), ...Object.keys(current?.valueByLocale ?? {})])
    for (const locale of locales) {
        const v = from?.valueByLocale?.[locale]
        update[locale] = v && v.status !== "new" && v.value != null
            ? { action: "set", value: v.value, needsReview: v.status === "needsReview" }
            : { action: "clear" }
    }
    return update
}

function clearLocales(current) {
    return Object.fromEntries(Object.keys(current?.valueByLocale ?? {}).map(l => [l, { action: "clear" }]))
}

function sameLocales(a, b) {
    const keys = new Set([...Object.keys(a?.valueByLocale ?? {}), ...Object.keys(b?.valueByLocale ?? {})])
    return [...keys].every(k => (a?.valueByLocale?.[k]?.value ?? null) === (b?.valueByLocale?.[k]?.value ?? null))
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
