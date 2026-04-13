/**
 * ep route - Route rule subcommand router
 */

const args = process.argv.slice(3)
const subcommand = args[0]

switch (subcommand) {
  case 'list':
    require('./list.js')
    break
  case 'show':
    require('./show.js')
    break
  case 'preview':
    require('./preview.js')
    break
  case 'active':
    require('./active.js')
    break
  case 'create':
    require('./create.js')
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
  default:
    console.log(`
Route Commands:
  ep route list [--json]                    List all route files
  ep route show <file> [--json]             Show rules in a file
  ep route preview <url> [--file <name>] [--json]  Preview route target for a URL
  ep route active                           Show active route files
  ep route active set <file>                Set active route file
  ep route create <name> [--content <text>] Create a route file
  ep route add <file> <pattern> <target>    Add a rule to file
  ep route update <file> <pattern> <target> Update a rule in file
  ep route delete <file> <pattern>          Delete a rule from file

Examples:
  ep route list
  ep route show dev-rules
  ep route preview "https://api.example.com/v1/users"
  ep route preview "https://cdn.com/assets/js/app.js" --file dev-rules
  ep route preview "https://api.test.com/data" --json
  ep route active set beta-rules
  ep route create staging --content "example.com localhost:3000"
  ep route add dev-rules "api.test.com" "localhost:8080"
  ep route update dev-rules "api.test.com" "localhost:9000"
  ep route delete dev-rules "api.test.com"
`)
    process.exit(1)
}