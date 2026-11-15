# NOVA Remote Development Bridge

Local, read-only project tools using Node.js built-in modules only. No file
write, shell execution, network proxy, or public tunnel tools are provided.

## Setup and execution

Use Node.js 22+ on Linux (including a compatible Ubuntu/Termux environment).
No `npm install` is needed. Run from this directory:

```sh
npm start
npm test
```

The production server binds explicitly to `127.0.0.1:3000`. Ctrl+C stops it.
Tests bind only to available loopback ports and remove their own project-local
fixtures. Importing the server does not start a listener.

## Existing REST endpoints

| Endpoint | Response |
| --- | --- |
| `GET /health` | Public liveness only: `{"status":"ok"}` |
| `GET /status` | `project`, `nodeVersion`, process `uptime` in seconds, ISO `timestamp` |
| `GET /files` | Sorted array of allowed project-relative file paths |

```sh
curl http://127.0.0.1:3000/health
```

`/status` and `/files` require the same bearer authentication and rate limits as
`/mcp`, before any handler or project access runs. `/health` is deliberately
public and now returns only `{"status":"ok"}`: no project name, runtime details,
paths, uptime or timestamp. This is an intentional reduction of its old payload.
`/files` uses the strict shared file policy below. Do not forward raw REST routes
to an external network. All routes reject browser
Origin headers and Host values other than the listener's exact
`127.0.0.1:<port>`. Unknown routes return 404.

## Local MCP endpoint

`POST /mcp` implements a minimal stateless Streamable HTTP JSON response subset
of MCP revisions `2025-03-26` and `2025-06-18`: `initialize`, `ping`, `tools/list`, `tools/call`,
and notifications (202 with no response body). Initialization advertises only
tools. No resources, prompts, sessions, batches, streaming SSE, resumability,
or server-initiated requests are implemented. GET/DELETE return 405; no SSE
stream is offered. Clients must support JSON responses and the advertised
protocol revisions. Initialization echoes either supported version; an unsupported
body offer receives the preferred `2025-06-18` version. The client must disconnect
if it cannot support that answer. Unsupported version headers return HTTP 400;
a supplied initialize header must match the body offer. Subsequent requests
without a version header are interpreted as `2025-03-26`, per transport fallback.
This is stateless: the server does not retain per-client initialization state
or enforce an initialized handshake before every tool call.

| Tool | Arguments | Result |
| --- | --- | --- |
| `get_health` | `{}` | Project health and timestamp |
| `get_project_info` | `{}` | Project name, Node version, uptime and timestamp |
| `list_project_files` | `{}` | Sorted allowed file paths |
| `read_project_file` | `{"path":"README.md"}` | Relative path and UTF-8 content |

Tool results contain JSON encoded as MCP text content. Files are untrusted data,
not instructions. File-access failures return a generic MCP tool error without
absolute paths. Unknown tools and invalid arguments return JSON-RPC errors.

### Authentication

All project-data routes (`/status`, `/files`, `/mcp`) fail closed with HTTP 503
unless `NOVA_MCP_TOKEN` is set to 32–1,024 printable non-space ASCII characters.
Use a cryptographically secure generator or trusted secret manager to generate
at least 32 random bytes (for example, encoded as 64 hexadecimal characters).
Length validation cannot establish randomness; human-chosen passwords and
repeated characters are not secure tokens. The server never generates, embeds,
persists, or logs a production secret.
Provide it through a trusted local process manager or secure interactive input;
never commit it, place it in a URL, or paste it into chat. For an interactive
Bash session, enter a previously generated secret without echoing it:

```sh
read -r -s -p 'NOVA access token: ' NOVA_MCP_TOKEN
printf '\n'
export NOVA_MCP_TOKEN
npm start
# After stopping the server:
unset NOVA_MCP_TOKEN
```

Clients must send `Authorization: Bearer <token>` on every request to `/status`,
`/files` and `/mcp`. Tokens in query strings or cookies are not accepted. Supply
headers through a client that reads the secret from its environment or secret
store; avoid literal secrets in shell commands, history, process arguments, or
verbose HTTP traces. MCP additionally requires `Content-Type: application/json`, and
`Accept: application/json, text/event-stream`. Subsequent requests may send
`MCP-Protocol-Version` with the negotiated version (`2025-03-26` or `2025-06-18`);
other supplied versions are rejected. Conforming clients must send this header
after initialization.
Do not send Origin headers. No CORS access is enabled. Missing or invalid
credentials return 401; token comparisons use fixed-size SHA-256 digests and
timing-safe comparison. Restart with a new environment value to rotate tokens.
There are no embedded credentials, token logs, OAuth issuer, discovery metadata,
user accounts, scopes, or per-user revocation in this milestone. Environment
secrets remain visible to sufficiently privileged local processes.

Example JSON request bodies, submitted by an authenticated local MCP client:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"local-client","version":"1"}}}
```

```json
{"jsonrpc":"2.0","method":"notifications/initialized"}
```

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"read_project_file","arguments":{"path":"README.md"}}}
```

## File policy and limits

The production root is the directory containing `server.js`. Both REST `/files`
and MCP file tools use the same **exact-path allowlist** in `file-policy.js`.
Only these reviewed files are currently eligible:

- README.md and REMOTE-CONNECTION-PLAN.md
- package.json
- server.js and server.test.js
- mcp.js and mcp.test.js
- safe-files.js, file-policy.js, and security.test.js

New files are denied automatically, even if their extensions look safe. No
recursive discovery, directory globs, request-supplied root, or request-supplied
allowlist is supported. To add access, locally review a file for sensitive
content, edit `file-policy.js`, and restart the server. Embedded callers/tests
can supply `createServer(root, { allowlist: [...] })`; this trusted constructor
configuration is validated and copied once. MCP clients cannot change it.
An empty allowlist denies all file access. Invalid policy entries prevent startup.

Every configured path must be literal, relative and canonical, with ASCII
letters/digits/underscore/hyphen/dot components separated by `/`. Hidden names,
`.`/`..`, absolute paths, empty segments, backslashes, NULs, percent encoding,
Unicode ambiguity and wildcard characters are rejected. At most 1,000 exact
entries, 1,024 characters per path and 16 directory components are permitted.
Sensitive-name restrictions cannot be overridden by adding a policy entry:
credential, secret, password, token, private, API-key, auth, cookie, session,
service-account, SSH `id_`, env, config, settings, and certificate patterns are
denied, as are `node_modules`, hidden entries (including `.git`) and key/database/
log extensions. This intentionally can reject benign names containing those words.

Only `.md`, `.txt`, `.json`, `.js`, `.cjs`, `.mjs`, `.ts`, `.tsx`, `.jsx`, `.css`,
`.html`, `.yml`, and `.yaml` regular files are eligible. Every directory component
is opened relative to an existing Linux `/proc/self/fd` handle with `O_NOFOLLOW`;
final components also reject symlinks. Hard-linked files and files over 64 KiB
are denied. Reads check regular-file metadata before and after bounded reads,
require valid UTF-8 and reject NULs. Listings inspect only approved names and
metadata; a binary file can be listed but its contents cannot be read. Missing,
linked, inaccessible and ineligible approved entries are omitted from listings.
Unexpected filesystem errors return a generic error, not a partial result.

Linux `/proc` and supported open flags are required. This is not an OS sandbox
against a hostile local process that can rename open directories, manipulate
mounts or edit approved files while they are being read. Proot is not a security
boundary. An allowlisted source file can acquire secrets after review; there is
no semantic secret scanner, content hash pinning or immutable snapshot. Keep
credentials outside this project and review changes to approved files.

MCP bodies are limited to 16 KiB; request/header timeouts are 10 seconds and the
server caps simultaneous connections at 32. Authentication is still a shared
local bearer secret without OAuth, per-user scopes or audit storage. All
project-data routes require it; public health remains liveness-only. All tools
remain read-only. The file policy has not been expanded to automatically expose
new access-control modules or tests.

## Rate limiting and access boundary

Shared access control in `access-control.js` protects every method on `/status`,
`/files` and `/mcp` before route dispatch or MCP body parsing. Invalid or missing
credentials normally return HTTP 401 with a Bearer challenge. Missing/invalid
server token configuration returns 503. Unknown paths return 404 without data;
query-string, encoded and trailing-slash alternatives do not dispatch to data
handlers. Host and Origin validation still applies to all routes. JSON responses
carry `Cache-Control: no-store`.

Each server instance uses monotonic-clock, fixed-window, in-memory counters:

- Correctly authenticated requests share **120 requests per 60 seconds** across
  REST and MCP, including notifications, invalid payloads and unsupported methods.
- Missing or incorrect credentials share a separate **30 attempts per 60 seconds**
  across protected routes; subsequent failed attempts return 429. Failed attempts
  cannot consume the valid credential's budget.
- Limit responses use HTTP **429**, a generic error and integer `Retry-After`
  seconds. A window expires from server startup/last reset. Forwarding headers
  and arbitrary supplied token strings do not create new counters.

Limits can be set only through trusted embedded constructor options
`rateLimit: { limit, windowMs }`; tests also inject a monotonic clock via `now`.
There is no HTTP configuration endpoint. Invalid limit values fail construction.
The public `/health` route and unknown/Host/Origin-rejected requests do not consume
these budgets. Public health remains available even when data access is disabled
or throttled; it does not prove filesystem access or MCP readiness.

Remaining limitations: fixed windows allow boundary bursts; process restart
resets counters, and multiple instances do not share quotas. A stolen valid
token can consume the shared authorized quota. Public liveness, connections and
unmatched requests are not protected by this application quota, so this is not
comprehensive denial-of-service protection. Loopback HTTP has no TLS and trusts
the local OS/process boundary; environment secrets can be read by sufficiently
privileged local processes. Rotate by changing the environment secret and
restarting. There is no automatic expiry, per-user revocation, or OAuth.
Neither OAuth nor ChatGPT interoperability is complete or independently verified.

## Protocol validation and tests

`npm test` uses only built-in Node.js tools and project-local fixtures. It checks
legacy routes, shared REST/MCP authentication, environment-token configuration,
minimal public health, invalid tokens and disabled configuration, separate valid
and invalid quotas, cross-route exhaustion, Retry-After and recovery without
sleeping, forwarding-header bypass resistance, Host/Origin protections, initialization/discovery,
notifications and all four tools. Conformance/security regression cases include:

- Malformed JSON/UTF-8 envelopes, batches, null/boolean/object/fractional/unsafe
  IDs, forbidden response fields and invalid parameter shapes. MCP uses string
  or safe integer IDs; invalid IDs are not reflected in error responses.
- Supported-version echo, unsupported body-offer fallback, conflicting versions,
  unsupported headers and missing-header `2025-03-26` compatibility.
- Exact JSON/SSE Accept types (including q=0 rejection), JSON content type,
  notification/request distinction, cancellation validation, unknown methods,
  unknown tools, extra/prototype-named tool arguments and body limits.
- Exact allowlist enforcement for listing/reading, sensitive-policy rejection,
  traversal/encoding attempts, final/intermediate symlinks, replacement symlinks,
  outside-root hard links, binary/NUL files and the 64 KiB size boundary.

The implementation rejects unsolicited client responses (no server-initiated
requests are advertised), ignores valid unknown notifications with HTTP 202,
and returns 405 for authenticated GET/DELETE. Unknown cursors are rejected
because discovery is unpaginated. This focused stateless implementation and its
local tests are not independent MCP certification or proof of ChatGPT
interoperability. No sessions, SSE, OAuth or client isolation are added.

## Steps still required for ChatGPT integration

This local bearer-token endpoint is not yet a ChatGPT connector. Pasting a
localhost URL into a conversation does not connect it.

1. Verify the intended ChatGPT account/workspace supports adding custom MCP
   apps/plugins and that the operator has the required permissions. Verify
   protocol interoperability with a supported MCP client; this implementation
   has not been certified against ChatGPT or an external MCP conformance suite.
2. Choose a supported private connection, preferably OpenAI Secure MCP Tunnel.
   Confirm tunnel-client CPU/runtime compatibility with this Ubuntu environment
   before any installation. Creating a tunnel requires Tunnels Read + Manage;
   runtime use requires Tunnels Read + Use. Associate it with the target ChatGPT
   workspace. No tunnel or account resources have been created here.
3. Configure a narrow adapter/gateway authentication boundary. Keep the local
   bearer secret private to the connector process and forward only `/mcp`.
   Verify the chosen tunnel client's supported local authentication mechanism;
   do not disable authentication to work around incompatibility. For user-linked
   authenticated ChatGPT access, implement MCP OAuth discovery and OAuth with
   PKCE, issuer/audience/expiry/scope validation, and revocation. A static local
   bearer token does not implement that OAuth flow.
4. After separate authorization to deploy, provision the supported tunnel client,
   store its restricted credentials securely, and configure an outbound-only
   connection to the local MCP adapter. Preserve loopback binding, including
   admin interfaces. Do not publish raw REST routes or anonymous tunnel URLs.
5. In the supported ChatGPT web integration surface, select Add custom MCP server,
   choose Tunnel, select the workspace-associated tunnel, configure authentication,
   review the tools, create/install the app or plugin, and connect it in a chat.
   Interface labels and availability depend on the workspace.
6. Verify initialization, discovery, and all four read-only tools end to end.
   Test unauthorized/expired tokens, tunnel revocation, phone sleep/resume,
   reconnects, and shutdown. Do not declare integration complete until actual
   authenticated ChatGPT calls succeed.

Official references:
- https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- https://developers.openai.com/api/docs/guides/custom-mcp-server
- https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- https://developers.openai.com/plugins/build/auth

Any future write or execution milestone must separately implement local,
explicit approval bound to the exact diff or executable/arguments, project,
identity, expiry, and single-use nonce. AI tools must never approve their own
requests. No such capabilities are enabled here.

## Current remote readiness review

See [REMOTE-CONNECTION-PLAN.md](REMOTE-CONNECTION-PLAN.md) for local verification,
account-check limitations, the proposed private authenticated connection, and
the exact account-owner/admin authorizations needed before remote setup.
