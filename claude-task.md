You are working in the easy-proxy project at /tmp/easy-proxy. You need to add session support in two areas that were missed by PR #42 (which added multi-session isolation infrastructure but only covered CLI/Web/Server, not MCP or docs).

## Background

PR #42 (already merged into main at commit 80824c8) added:

1. CLI commands: ep session create/list/delete/prune, ep --session <id> <command>
2. Core infra: bin/lib/sessions.js (session registry), bin/lib/ep-home.js (EP_HOME resolver), bin/lib/session-args.js (--session flag)
3. Server: core/sessions.ts (read-only TS mirror), server/sessions.ts (GET /api/sessions endpoint)
4. Web UI: SessionSwitcher component in header

**What was NOT covered (your task):**

### Task 1: Update README.md

Add a "多 Session 隔离" section after the existing "MCP Server" section. Document:

- What sessions are (independent ep processes with isolated EP_HOME and port)
- CLI commands: ep session create, ep session list, ep session delete, ep session prune
- ep --session <id> <command> for operating on a specific session
- Default session backward compatibility
- Shared CA (no need to reinstall certificates)
- MCP tools that support sessions (after your Task 2 changes)
- Environment variable: EP_HOME overrides data directory

### Task 2: Update mcp-server.js

The MCP server currently has NO session support. The only change from PR #42 was replacing os.homedir() with resolveEpHome(). You need to:

#### 2a. Import session library at the top of mcp-server.js

Add these imports:

```js
const {
  readRegistry, getSession, listSessions, createSession,
  deleteSession, isPidAlive, allocatePort, generateId, sessionDir
} = require('./bin/lib/sessions')
const { GLOBAL_DEFAULT_PORT } = require('./bin/lib/session-args')
```

#### 2b. Add helper functions

Add these helper functions (place them after the existing waitForProxyUrl function, before the mcpServer declaration):

```js
/** Resolve session id to proxy base URL. Falls back to default if no session id given. */
function resolveSessionBaseUrl(sessionId) {
  if (!sessionId) return getProxyBaseUrl()
  const record = getSession(sessionId)
  if (!record) throw new Error(`session not found: ${sessionId}`)
  return `http://127.0.0.1:${record.port}`
}

/** proxyApi with optional session support */
function proxyApiForSession(sessionId, method, pathname, body) {
  const base = resolveSessionBaseUrl(sessionId)
  const url = base.replace(/\/$/, '') + pathname
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body !== undefined) opts.body = typeof body === 'string' ? body : JSON.stringify(body)
  return fetch(url, opts).then((res) => {
    if (!res.ok) return res.text().then((t) => { throw new Error(t || res.statusText) })
    return res.headers.get('content-type')?.includes('application/json') ? res.json() : res.text()
  })
}
```

#### 2c. Add 3 new session management tools

Add these registerTool calls after the existing tools:

**1. create_session:** Spawn a new proxy session in MCP context
- Input: `{ name?: z.string().optional(), port?: z.number().optional() }`
- Flow: allocate port → spawn child with EP_HOME=<session dir>, PORT=<port>, EP_HEADLESS=1 → wait for HTTP ready → register in sessions.json → return { id, port, proxyUrl }
- Reuse spawn logic from bin/commands/session/create.js but in MCP fashion (stdio: 'ignore' for pipes)
- The index path is path.join(__dirname, 'index.js')
- Set EP_SESSION_ID in child env for identification

**2. delete_session:** Delete a session by id
- Input: `{ id: z.string(), clean: z.boolean().optional() }`
- Flow: kill process (SIGTERM) → removeSession from registry → optionally clean data dir (with safety guard)
- Return { id, killed, cleaned } confirmation

**3. list_sessions:** List all sessions
- Input: `{}`
- Return text: JSON array of sessions with alive status

#### 2d. Add optional session parameter to ALL existing route/mock tools

For every existing MCP tool that calls proxyApi(), add an optional session parameter:

Tools to modify (add `session: z.string().optional().describe('Session ID')` to inputSchema):
- mock_rule_list
- mock_rule_add
- mock_rule_update
- mock_rule_delete
- route_rule_list
- route_rule_active_get
- route_rule_active_set
- route_rule_create_file
- route_rule_add
- route_rule_update
- route_rule_delete
- route_preview

For each tool handler:
1. Destructure `session` from params
2. Replace `proxyApi(...)` calls with `proxyApiForSession(session, ...)`
3. Keep original proxyApi call signature as fallback (no change to existing behavior)

For route_rule_active_get/set and route_rule_create_file: also add the session parameter to inputSchema.

Do NOT add session parameter to start_proxy and get_proxy_url (they are about the default proxy).

### Constraints

- Keep ALL existing behavior exactly as-is when session parameter is not provided
- The spawn logic in create_session must: allocate port via allocatePort() from sessions lib, spawn child with correct env, poll for HTTP ready, register via createSession()
- All session IDs used in route/mock tools are looked up via getSession(id) to find the correct port
- The spawn should use stdio: 'ignore' for MCP context (non-interactive)
- Write the sessions.json via createSession() from sessions lib, not manually

### Verification

After editing:
1. Run `node -c mcp-server.js` to verify syntax
2. If syntax errors, fix them

IMPORTANT: Only edit mcp-server.js and README.md. Do NOT touch any other files.

When completely finished, run this command to notify me:
openclaw system event --text "Done: MCP session tools + README docs for easy-proxy" --mode now
