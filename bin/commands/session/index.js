/**
 * meddle session - Multi-instance session management (preview)
 *
 * Each session is an independent `meddle` process with its own MEDDLE_HOME
 * (route-rules, mocks, plugins, settings) and port. The CA store
 * (~/.meddle/ca) is shared across all sessions so HTTPS interception
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

  meddle session create [--name <label>] [--port <port>]
                              Create a new proxy session with its own
                              MEDDLE_HOME and port. Returns the session id.
  meddle session list             List all sessions with liveness check.
  meddle session delete <id> [--clean]
                              Stop the session, remove from registry.
                              --clean also deletes its data directory.
  meddle session prune            Remove registry entries whose process is
                              no longer alive (keeps data directories).

Operating on a specific session:
  meddle --session <id> route list
  meddle --session <id> mock add --name "API" --pattern "api.test.com"
  meddle --session <id> status

Notes:
  - The default session (no --session) uses ~/.meddle and is fully backward
    compatible. Existing commands and tests are unaffected.
  - --session and the MEDDLE_HOME environment variable are mutually exclusive.
  - All sessions share the same CA (~/.meddle/ca); only config is isolated.

Examples:
  meddle session create --name my-debug
  meddle --session my-debug-1718283600 route list
  meddle session delete my-debug-1718283600 --clean
`)
    process.exit(subcommand ? 1 : 0)
}
