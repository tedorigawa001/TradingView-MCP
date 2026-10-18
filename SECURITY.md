# Security Policy

## Supported Versions

Only the latest release of [`bushido-tradingview-mcp` on npm](https://www.npmjs.com/package/bushido-tradingview-mcp)
receives security fixes. Fixes are released as a new version; earlier versions are not patched. Please update before
reporting, and check whether the issue still occurs on the latest release.

## Reporting a Vulnerability

Please report vulnerabilities privately through GitHub's private vulnerability reporting:
**[Report a vulnerability](https://github.com/tedorigawa001/TradingView-MCP/security/advisories/new)** (the
repository's Security tab). Do not open a public issue, pull request or discussion for a suspected vulnerability.

A useful report includes:

- the package version, the operating system and the Node.js version;
- the affected tool, CLI command or file, and the steps or a minimal script that reproduce the issue;
- what an attacker needs (for example another local user, a crafted file, or a malicious web page) and what they gain;
- any logs, with credentials, account IDs and personal data removed.

This project has a single maintainer, so reports are handled on a best-effort basis. You will get an acknowledgement in
the advisory, and the fix and its release will be coordinated with you there. Fixed vulnerabilities are published as a
GitHub security advisory, crediting the reporter unless you prefer otherwise. Please give a reasonable time for a fix
to be released before disclosing details publicly.

## Scope

In scope: the code in this repository and the published npm package, including the MCP server, its tools, the CLIs and
collectors, the local stores they write, and the export and publish paths.

Out of scope:

- vulnerabilities in TradingView Desktop, TradingView's services, or the data providers this project reads from (OANDA,
  CFTC, CME, central banks, statistical agencies); report those to their owners;
- the documented, accepted risks listed below, unless you find a way around their stated limits;
- attacks that require an already compromised machine or user account, or the ability to run code as the same user;
- denial of service that needs only local write access to your own data directory.

## Security Model and Known Limits

The server and its CLIs run locally, as your user. In short (details in [docs/security-review.md](docs/security-review.md)
and the README's [Security](README.md#security) section):

- **The Chrome DevTools Protocol port is the main trust boundary.** While TradingView Desktop runs with
  `--remote-debugging-port=9222`, any program on the same machine can control the signed-in TradingView session. Enable
  it only while you use the AI, and do not use this setup on a shared machine. This risk is accepted, not mitigated.
- **The server is read-oriented.** It places no orders and has no Replay Trading, webhooks, watchlist changes or
  deletion of existing alerts. Its few writes (owned Pine versions, owned studies, expiring alerts, Bar Replay steps) are
  behind confirmation gates.
- **What the AI provider sees.** Tool results go to your AI agent and its provider. `get_chart_screenshot` sends
  everything visible on the screen, including watchlists.
- **Credentials.** API credentials, such as the OANDA account ID and access token, are read from the environment (the
  daily-collection example reads them from the login Keychain). They are never written to stdout, logs, stores, raw
  evidence or exports. Error messages that can reach an AI client are redacted.
- **Local files.** Stores and evidence are owner-only. Reads refuse symbolic links and named pipes, and records are
  appended under a lock. Exports and evidence are published by exclusive hard links, never overwriting a file. Split
  exports refuse an output directory, or any directory above it, that other users can change (group- or
  world-writable without the sticky bit, or owned by another user). macOS ACLs and volumes mounted with ownership
  ignored are not detected; on Windows the directory check does not apply, so export under `%USERPROFILE%`.
- **Supply chain.** CI runs `npm audit --audit-level=high` on every push, and the package has no install scripts.

## Security Fixes

Security-relevant changes are recorded in [docs/BACKLOG.md](docs/BACKLOG.md) and the reviews in
[docs/security-review.md](docs/security-review.md). For example, 0.1.44 fixed the findings of an independent review of
0.1.43 (BACKLOG 103-11).
