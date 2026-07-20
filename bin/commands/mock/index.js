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

Add Options:
  --name <n>       Rule name
  --pattern <p>    URL pattern (regex or string)
  --method <m>     HTTP method (GET, POST, *, default: *)
  --status <s>     Response status code (default: 200)
  --body <b>       Response body content
  --delay <d>      Response delay in ms (default: 0)

Examples:
  meddle mock list
  meddle mock add --name "API Mock" --pattern "example.com/api" --status 200
  meddle mock update 1 --status 404
  meddle mock delete 1
`)
    process.exit(1)
}