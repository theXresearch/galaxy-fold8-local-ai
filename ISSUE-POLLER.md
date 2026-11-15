# NOVA GitHub issue intake — dry-run prototype

This is an **opt-in, one-shot, read-only** GitHub Issues intake prototype. It does not invoke Codex, start a background service, persist state, edit files, or report results to GitHub. Existing NOVA MCP endpoints are unchanged.

## Usage (only after local review)

Requires Node.js 22+ and a **fine-grained GitHub token** with read-only Issues access to this repository. Keep the token outside the repository and never paste it into chat or screenshots. In a private shell, set `NOVA_GITHUB_TOKEN` using a secure input method, then run `node issue-poller.js`. Afterward unset the variable. Never pass the token as a CLI argument.

Only open Issues authored by `theXresearch`, labeled `nova-approved`, and with exactly this three-line body are accepted:

```text
NOVA_TASK_V1
task_id: inspect-readme
summary: Inspect README only
```

Output contains only a JSON task description and a count. **Even an accepted issue cannot execute anything.** Labels are not a strong approval boundary; a future runner must independently authenticate approval, prevent replays, and sandbox execution. This prototype does not yet poll periodically, paginate beyond 30 issues, or cryptographically verify GitHub responses beyond HTTPS and token authorization.

Run `node --test issue-poller.test.js` to test local parsing and a mocked API. Run `npm test` for the full suite. Tests are included but have not yet been run on the Fold8 device.

## Future stages (require separate approval)

Review and test on Fold8; add durable idempotent queue and operator approval; only then design an isolated Codex executor and reporting workflow. Do not merge or deploy based solely on this prototype.
