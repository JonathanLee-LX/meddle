/**
 * meddle route - Route rule subcommand router
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
  meddle route list [--json]                    List all route files
  meddle route show <file> [--json]             Show rules in a file
  meddle route preview <url> [--file <name>] [--json]  Preview route target for a URL
  meddle route active                           Show active route files
  meddle route active set <file>                Set active route file
  meddle route create <name> [--content <text>] Create a route file
  meddle route add <file> <pattern> <target>    Add a rule to file
  meddle route update <file> <pattern> <target> Update a rule in file
  meddle route delete <file> <pattern>          Delete a rule from file

Examples:
  meddle route list
  meddle route show dev-rules
  meddle route preview "https://api.example.com/v1/users"
  meddle route preview "https://cdn.com/assets/js/app.js" --file dev-rules
  meddle route preview "https://api.test.com/data" --json
  meddle route active set beta-rules
  meddle route create staging --content "example.com localhost:3000"
  meddle route add dev-rules "api.test.com" "localhost:8080"
  meddle route update dev-rules "api.test.com" "localhost:9000"
  meddle route delete dev-rules "api.test.com"
`)
    process.exit(1)
}