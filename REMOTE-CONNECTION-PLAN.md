# Private remote connection readiness

Historical deployment plan: the local security implementation has since added
strict exact-path allowlisting, protocol regression tests, shared REST/MCP authentication and rate limiting. See README.md for
current protocol/file behavior. The account checks and test timings below are
historical observations, not a new account entitlement check.

## Observed local state

Inspected server.js, mcp.js, safe-files.js, README.md, package.json and both test
files. Local environment reports Node.js v22.23.5, Linux ARM64, and accessible
/proc/self/fd. tunnel-client was not found in PATH; no installation was attempted.
Production remains bound to 127.0.0.1:3000. No persistent credentials, account
resources, network services, or tunnel profiles were created.

Existing automated tests passed: 8 tests, 8 passes, 0 failures, 0 skips, exit 0;
reported duration 276.438333 ms. Tests use temporary in-memory authentication
values and project-local fixtures, not account credentials. Their loopback
listeners are closed and fixtures removed.

## Protocol verification and limits

This is implementation review plus the built-in local HTTP integration tests,
not certification by ChatGPT, MCP Inspector, or an independent MCP client.

| Capability | Local evidence / remaining work |
| --- | --- |
| Protocol | initialize returns 2025-06-18; newer clients must accept that revision or stop |
| Transport | POST JSON responses, stateless, both JSON/SSE Accept types required |
| GET | Authenticated GET returns 405, permitted when no SSE stream is offered |
| Notifications | Valid notifications receive 202 without a body |
| Discovery | tools/list returns exactly four read-only tool definitions |
| Calls | Health, project information, nested listing, and text reads exercised by tests |
| File policy | Traversal, hidden/sensitive names, symlinks, hard links, binary reads and size restrictions tested |
| Authentication | Local bearer only; disabled configuration and bad authorization fail closed |
| Sessions / SSE | No sessions, server-initiated messages, or SSE streams; these are not advertised |
| OAuth | Not implemented: no protected-resource metadata, authorization-server discovery, user-linked scopes or access-token validation |

Available tools:
- get_health: no arguments; health, project and timestamp.
- get_project_info: no arguments; project, Node version, uptime and timestamp.
- list_project_files: no arguments; bounded relative file list.
- read_project_file: path argument; bounded eligible UTF-8 contents.

Before remote deployment, perform independent client interoperability tests,
including version fallback, missing-version semantics, malformed JSON-RPC,
invalid IDs/parameter types, media-type parsing, and initialization lifecycle.
Current tests cover selected behavior, not exhaustive protocol conformance.
The implementation accepts some notifications without validating their method
or lifecycle; it should not be represented as a full protocol validator.

## Account check result

The available read-only plugin discovery tool was queried for NOVA/custom MCP/
secure tunnels. It returned unrelated catalog apps, no relevant NOVA integration.
Search results are not exhaustive and do not prove custom-MCP entitlement.
No available tool exposes this user's plan, workspace admin policy, custom MCP
creation permission, Platform organization tunnel roles, or workspace mapping.
Account eligibility therefore remains UNVERIFIED, not denied.

The account owner must inspect ChatGPT on the web at https://chatgpt.com/plugins
for Add custom MCP server and Connection: Tunnel in the intended workspace.
Do not create/install anything during this eligibility check. If unavailable,
check workspace/admin restrictions; do not substitute a public anonymous URL.
More catalog plugins may exist at https://chatgpt.com/plugins, but catalog
availability does not establish custom-server permissions.

## Proposed connection

ChatGPT private custom MCP app/plugin
  -> OpenAI Secure MCP Tunnel (workspace/organization authorized)
  -> device-initiated outbound HTTPS polling
  -> local tunnel client
  -> OAuth-aware MCP gateway/adapter on loopback, if required
  -> NOVA http://127.0.0.1:3000/mcp

Forward only /mcp and specifically required OAuth discovery paths. Never forward
/health, /status, /files, arbitrary URLs, or local admin surfaces. Legacy REST
data routes now require shared bearer authentication and rate limits; only minimal /health is public. Preserve the exact loopback Host
header expected by NOVA; verify how the supported client handles Host and Origin
rather than weakening checks to accommodate forwarding.

Authentication has three separate boundaries:
1. Tunnel runtime: restricted Platform runtime key with Tunnels Read + Use.
2. User authorization: MCP OAuth 2.1 authorization-code + S256 PKCE, protected
   resource and authorization-server metadata, resource/audience validation,
   issuer/signature/expiry checks, and read-only scopes. Use the chosen supported
   OAuth client registration mode and exact callback shown by ChatGPT.
3. Local upstream: NOVA bearer token supplied securely to a supported local
   transport configuration or a narrow adapter. Verify client support before
   choosing this arrangement; arbitrary static header injection is not assumed.
   Never forward one user's OAuth token as a generic upstream credential.

OAuth discovery can traverse Secure MCP Tunnel. Its authorization server is not
made reachable automatically: confirm browser authorization and server token
exchange connectivity separately. Prefer an approved existing identity provider
instead of building a password/authentication service inside NOVA.

Review the implemented positive file allowlist before deployment; ordinary source/JSON names
can contain secrets despite the current exclusions. Read access sends those
selected contents through OpenAI. No write or execution capabilities are part
of this plan. Keep device process/admin interfaces loopback-only and verify the
supported tunnel binary's Linux ARM64 and Ubuntu/proot compatibility first.

## Next-stage approvals and sequence

Current authorization covers local inspection, documentation, and tests only.
The following actions need separate explicit authorization before performing them:

1. Identify the exact ChatGPT workspace, Platform organization and intended
   operator. Owner/admin grants custom MCP app creation/use as required by policy.
   Platform owner/RBAC admin grants Tunnels Read + Manage to the tunnel creator
   and Read + Use to the runtime/operator. Verify workspace association.
2. Approve the exact set of project files that may be shared and the four read-only
   tools. Review a positive allowlist and data-handling policy before remote calls.
3. Approve the authentication provider and client configuration. Authorize any
   OAuth registration, consent, scope grants and credential creation/storage.
   Enter secrets only in secure local/account interfaces, never in chat.
4. Approve downloading/installing the supported tunnel client on this device and
   any proposed process supervision. No automatic startup or service installation
   should be inferred from permission to test a foreground client.
5. Approve creation/association of the private tunnel and restricted runtime key,
   then approve starting outbound HTTPS traffic to the documented OpenAI tunnel
   service. No inbound firewall, router forwarding, or public device listener.
6. In ChatGPT web, Add custom MCP server -> Tunnel -> choose the associated tunnel
   -> configure OAuth -> review -> create/install the private app/plugin.
   The account owner completes sign-in and consent; do not select anonymous mode.
7. Verify the client's local profile with its documented doctor command, confirm
   authenticated readiness, then test discovery and each approved tool from
   ChatGPT. Test expired/revoked tokens, wrong scopes, unauthorized identities,
   reconnects, phone sleep, and local shutdown. Record evidence without secrets.
8. Stop/revoke the tunnel if checks fail. Call the integration complete only
   after actual authenticated ChatGPT tool calls succeed.

No approval to this stage authorizes file writes, shell execution, public
publication, broad workspace distribution, or weakening local authentication.

## Official references

- MCP 2025-06-18 transport: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- ChatGPT custom MCP connection: https://developers.openai.com/api/docs/guides/custom-mcp-server
- Private outbound tunnel and roles: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- MCP OAuth requirements: https://developers.openai.com/plugins/build/auth
