import { readFile } from "node:fs/promises"
import { connect } from "framer-api"

export async function loadConfig() {
    const url = new URL("../blog.config.json", import.meta.url)
    return JSON.parse(await readFile(url, "utf8"))
}

// Opens the Framer project named by FRAMER_PROJECT_URL, authenticated with FRAMER_API_KEY.
export async function openProject() {
    const projectUrl = process.env.FRAMER_PROJECT_URL
    if (!projectUrl) {
        throw new Error("Set FRAMER_PROJECT_URL to the project's URL (https://framer.com/projects/...).")
    }
    if (!process.env.FRAMER_API_KEY) {
        throw new Error("Set FRAMER_API_KEY (Framer → Site Settings → API Keys).")
    }
    return connect(projectUrl)
}

export async function getCollection(framer, name) {
    const collections = await framer.getCollections()
    const collection = collections.find(c => c.name === name)
    if (!collection) {
        const names = collections.map(c => `"${c.name}"`).join(", ")
        throw new Error(`No CMS collection named "${name}". The project has: ${names}`)
    }
    return collection
}
