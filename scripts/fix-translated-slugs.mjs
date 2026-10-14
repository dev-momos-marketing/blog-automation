// One-off: gives Blog posts that share a translated slug their own slug, as approved by the blog owner
// (see review/duplicate-translated-slugs.md). Only these translated slugs change; nothing is published.
//
// Usage:
//   node scripts/fix-translated-slugs.mjs            # dry run
//   node scripts/fix-translated-slugs.mjs --write    # back up, then change all of them in one call
//   node scripts/fix-translated-slugs.mjs --restore backups/slugs-<timestamp>.json
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { getCollection, loadConfig, openProject } from "./lib.mjs"

// [locale, post (English slug), current translated slug, new translated slug]
const CHANGES = [
    ["fr-CA", "best-ai-for-improving-restaurant-workflows-copy-copy-copy", "meilleure-ia-pour-ameliorer-les-flux-de-travail-des-restaurants", "comment-la-gestion-de-la-reputation-profite-a-un-restaurant"],
    ["fr-CA", "best-restaurant-operations-software", "meilleur-logiciel-de-gestion-de-restaurant", "meilleur-logiciel-d-operations-pour-restaurants"],
    ["fr-CA", "best-ai-agents-for-restaurant-operations", "meilleure-ia-pour-ameliorer-le-service-client-des-restaurants", "meilleure-ia-pour-la-gestion-des-restaurants"],
    ["es-ES", "best-restaurant-customer-data-platform", "mejor-software-de-business-intelligence-para-restaurantes", "mejor-plataforma-de-datos-de-clientes-para-restaurantes"],
    ["es-ES", "best-restaurant-operations-software", "mejor-software-de-gestion-de-restaurantes", "mejor-software-de-operaciones-para-restaurantes"],
    ["es-ES", "best-ai-agents-for-restaurant-operations", "mejor-ia-para-mejorar-la-atencion-al-cliente-en-restaurantes", "mejor-ia-para-operaciones-de-restauracion"],
    ["ja-JP", "how-ai-benefits-restaurants", "restaurant-workflow-improvement-best-ai", "how-ai-benefits-restaurants"],
    ["ja-JP", "best-restaurant-automation-software", "restaurant-workflow-improvement-best-ai", "restaurant-automation-system-best"],
    ["ja-JP", "best-ai-tools-to-respond-to-reviews", "飲食店向けチャットボット", "review-reply-best-ai-tools"],
    ["ja-JP", "best-voice-of-customer-tools-for-restaurants", "restaurants-chatbot", "voc-analysis-tools-hospitality"],
    ["ja-JP", "restaurant-efficiency", "restaurant-management-optimization", "restaurant-efficiency-improvement"],
]

const args = process.argv.slice(2)
const write = args.includes("--write")
const restoreFile = args.includes("--restore") ? args[args.indexOf("--restore") + 1] : undefined

const config = await loadConfig()
const framer = await openProject()
try {
    const localeId = Object.fromEntries((await framer.getLocales()).map(l => [l.code, l.id]))
    const collection = await getCollection(framer, config.collection)
    const items = await collection.getItems()
    const bySlug = new Map(items.map(i => [i.slug, i]))

    // Plan: [post, locale, from, to]; each post's translated slug is one localization source of type "slug".
    const rows = restoreFile
        ? JSON.parse(await readFile(restoreFile, "utf8")).map(r => [r.post, r.locale, r.now, r.was])
        : CHANGES.map(([locale, post, from, to]) => [post, locale, from, to])

    const valuesBySource = {}
    const backup = []
    for (const [post, locale, from, to] of rows) {
        const item = bySlug.get(post)
        if (!item) throw new Error(`No Blog post "${post}".`)
        const current = item.slugByLocale?.[localeId[locale]]?.value
        if (current !== from) throw new Error(`${post} [${locale}] slug is "${current}", expected "${from}". Nothing was changed.`)
        const [group] = await framer.getLocalizationGroups({ groupIds: [item.id] })
        const source = group.sources.find(s => s.type === "slug")
        ;(valuesBySource[source.id] ??= {})[localeId[locale]] = { action: "set", value: to, needsReview: false }
        backup.push({ post, locale, was: from, now: to })
        console.log(`${write || restoreFile ? "set  " : "would"} ${locale} ${post}: ${from} → ${to}`)
    }

    // No two posts may end up with the same translated slug.
    const after = new Map()
    for (const item of items) {
        for (const [code, id] of Object.entries(localeId)) {
            const change = rows.find(([post, locale]) => post === item.slug && locale === code)
            const value = change ? change[3] : item.slugByLocale?.[id]?.value
            if (!value) continue
            const key = `${code} ${value}`
            if (after.has(key)) throw new Error(`After the change, ${code} slug "${value}" would still be used by ${after.get(key)} and ${item.slug}. Nothing was changed.`)
            after.set(key, item.slug)
        }
    }
    console.log(`\nNo duplicate translated slugs after the change.`)
    if (!write && !restoreFile) {
        console.log("Dry run: nothing was saved.")
    } else {
        if (write) {
            await mkdir("backups", { recursive: true })
            const file = `backups/slugs-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
            await writeFile(file, JSON.stringify(backup, null, 2))
            console.log(`Backup: ${file}`)
        }
        const result = await framer.setLocalizationData({ valuesBySource })
        if (result.valuesBySource.errors.length) throw new Error(`Framer reported: ${JSON.stringify(result.valuesBySource.errors)}`)
        console.log(`Saved ${rows.length} translated slug(s) in one call.`)
    }
} finally {
    await framer.disconnect()
}
