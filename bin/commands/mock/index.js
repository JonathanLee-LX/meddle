/**
 * ep mock - Mock rule subcommand router
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
  ep mock list [--json]           List all mock rules
  ep mock add [options]           Add a mock rule
  ep mock update <id> [options]   Update a mock rule
  ep mock delete <id>             Delete a mock rule
  ep mock enable <id>             Enable a mock rule
  ep mock disable <id>            Disable a mock rule

Add Options:
  --name <n>       Rule name
  --pattern <p>    URL pattern (regex or string)
  --method <m>     HTTP method (GET, POST, *, default: *)
  --status <s>     Response status code (default: 200)
  --body <b>       Response body content
  --delay <d>      Response delay in ms (default: 0)

Examples:
  ep mock list
  ep mock add --name "API Mock" --pattern "example.com/api" --status 200
  ep mock update 1 --status 404
  ep mock delete 1
`)
    process.exit(1)
}