// Read-only: lists every CMS collection and its fields, so blog.config.json can name the right ones.
// Usage: npm run inspect
import { openProject } from "./lib.mjs"

const framer = await openProject()
try {
    for (const collection of await framer.getCollections()) {
        const items = await collection.getItems()
        const drafts = items.filter(i => i.draft).length
        console.log(`\n${collection.name}  (${items.length} items, ${drafts} drafts, managed by ${collection.managedBy})`)

        for (const field of await collection.getFields()) {
            const cases = field.type === "enum" ? `  [${field.cases.map(c => c.name).join(" | ")}]` : ""
            console.log(`  - ${field.name}: ${field.type}${cases}`)
        }
    }
} finally {
    await framer.disconnect()
}
