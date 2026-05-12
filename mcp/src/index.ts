import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { createShikumikaClient } from "./client.js"
import { registerTaskTools } from "./tools/tasks.js"
import { registerProjectTools } from "./tools/projects.js"
import { registerNoteTools } from "./tools/notes.js"
import { registerSpaceTools } from "./tools/spaces.js"
import { registerHabitTools } from "./tools/habits.js"
import { registerCalendarTools } from "./tools/calendar.js"
import { registerDashboardTools } from "./tools/dashboard.js"

const server = new McpServer({
  name: "shikumika",
  version: "0.1.0",
})

const client = createShikumikaClient()

registerTaskTools(server, client)
registerProjectTools(server, client)
registerNoteTools(server, client)
registerSpaceTools(server, client)
registerHabitTools(server, client)
registerCalendarTools(server, client)
registerDashboardTools(server, client)

const transport = new StdioServerTransport()
await server.connect(transport)
