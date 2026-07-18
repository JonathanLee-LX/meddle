/**
 * ep session - Multi-instance session management (preview)
 *
 * Each session is an independent `ep` process with its own EP_HOME
 * (route-rules, mocks, plugins, settings) and port. The CA store
 * (~/.ep/ca) is shared across all sessions so HTTPS interception
 * works without re-installing certificates per session.
 *
 * See docs/proposals/multi-session-isolation.md for the full design.
 */

const args = process.argv.slice(3)
const subcommand = args[0]

switch (subcommand) {
  case 'create':
    require('./create.js')
    break
  case 'list':
  case 'ls':
    require('./list.js')
    break
  case 'delete':
  case 'rm':
    require('./delete.js')
    break
  case 'prune':
    require('./prune.js')
    break
  default:
    console.log(`
Session Commands (multi-instance isolation, preview):

  ep session create [--name <label>] [--port <port>]
                              Create a new proxy session with its own
                              EP_HOME and port. Returns the session id.
  ep session list             List all sessions with liveness check.
  ep session delete <id> [--clean]
                              Stop the session, remove from registry.
                              --clean also deletes its data directory.
  ep session prune            Remove registry entries whose process is
                              no longer alive (keeps data directories).

Operating on a specific session:
  ep --session <id> route list
  ep --session <id> mock add --name "API" --pattern "api.test.com"
  ep --session <id> status

Notes:
  - The default session (no --session) uses ~/.ep and is fully backward
    compatible. Existing commands and tests are unaffected.
  - --session and the EP_HOME environment variable are mutually exclusive.
  - All sessions share the same CA (~/.ep/ca); only config is isolated.

Examples:
  ep session create --name my-debug
  ep --session my-debug-1718283600 route list
  ep session delete my-debug-1718283600 --clean
`)
    process.exit(subcommand ? 1 : 0)
}
