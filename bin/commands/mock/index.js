/**
 * meddle mock - Mock rule subcommand router
 */

const args = process.argv.slice(3)
const subcommand = args[0]

switch (subcommand) {
  case 'list':
    require('./list.js')
    break
  case 'add':
    require('./add.js')
    break
  case 'update':
    require('./update.js')
    break
  case 'delete':
    require('./delete.js')
    break
  case 'enable':
  case 'disable':
    require('./toggle.js')
    break
  default:
    console.log(`
Mock Commands:
  meddle mock list [--json]           List all mock rules
  meddle mock add [options]           Add a mock rule
  meddle mock update <id> [options]   Update a mock rule
  meddle mock delete <id>             Delete a mock rule
  meddle mock enable <id>             Enable a mock rule
  meddle mock disable <id>            Disable a mock rule

Add / Update Options:
  --name <n>       Rule name
  --pattern <p>    URL pattern (regex or string; may include query)
  --query <q>      Query match condition (URL search substring, e.g. window_key=A)
  --method <m>     HTTP method (GET, POST, *, default: *)
  --status <s>     Response status code (default: 200)
  --body <b>       Response body content
  --delay <d>      Response delay in ms (default: 0)
  --headers <json> Response headers JSON (values may use {origin})
  --cors           Shortcut: credentials-friendly CORS headers with {origin}

Examples:
  meddle mock list
  meddle mock add --name "API Mock" --pattern "example.com/api" --status 200
  meddle mock add --name "Policy A" --pattern "/ops/.*/policy" --query "window_key=A" --body '{"key":"A"}' --cors
  meddle mock update 1 --status 404 --headers '{"X-Debug":"1"}'
  meddle mock delete 1
`)
    process.exit(1)
}
