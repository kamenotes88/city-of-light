# Security and private reporting

City of Light uses the Project World engine. A package check verifies the
listed bytes; it does not certify the publisher, eliminate every vulnerability
or authorize access to an account.

## Report privately

Use **Security → Report a vulnerability** in the official
[kamenotes88/city-of-light repository](https://github.com/kamenotes88/city-of-light/security/advisories/new)
to submit a private report. GitHub private vulnerability reporting is enabled
for this public repository; its configuration was verified on October 11, 2026.
Secret scanning and push protection are also enabled. These configuration checks
are separate from submitting or accepting an actual vulnerability report.

Do not put passwords, tokens, private worlds or exploit details in a public
issue. If the private route is unavailable, a public issue may ask only for a
private reporting channel, with no vulnerability details or sensitive attachments.
The maintainer must establish that channel before you send sensitive information.
Public GitHub Issues is the permission/help contact, not a confidential inbox.

Send the version, OS/browser, affected component, expected and observed behavior,
and a minimal redacted reproduction through the verified private route. Allow
time to reproduce a report and prepare a fix before disclosing exploit details.
No response deadline, bug bounty or support SLA is promised.

## Package boundaries

- The installer checks declared SHA256, size, archive membership and content.
  It preserves an existing installation or world when these checks fail.
- The normal route pins a GitHub commit and reads direct HTTPS URLs without
  redirects. An integrity manifest is not a signed publisher identity.
- Backups and language packs are parsed as bounded data; those data files do
  not supply executable engine code.
- Optional extension references are separate. Installation, account connection,
  global settings, spending and publication need their own permission.

Only execute an engine from a source you trust. The Node VM used by the local
generator is **not a security sandbox** for untrusted code. Project files and
browser storage are local and are not encrypted by this preview. Credential
field-name checks cannot identify every secret pasted into free text. Review
context before sharing it with an AI service.

Keep a compatible full backup before changing engine versions. Do not expose a
personal HTTP server or graph publicly for mobile access. Optional release notices fetch only a bounded text file from our fixed public
GitHub URL, at most daily. They never execute the feed, upload a world or install
a release. Disable the checks in Updates. GitHub receives ordinary network
information such as IP. Notices are informational, not signed update authority.
Automatic installation, a signed update service and authenticated hosted services
are not supplied. A previously downloaded version receives no automatic fix.

## Review scope

Current checked Pro preview 0.15.1 passed its build and explicit `--check`.
Thirty JavaScript suites and sixteen Python installer cases ran (fifteen passed;
one OS-dependent case was skipped). Focused candidate checks include working-report
flow (37), source/state preservation (25), history-import UI (13) and persistence
lifecycle (14). The normalized source SHA256 is
`7c0e19c9977bd69cf71469a51a85d3ef83ee59ed0580572e523c795bdec3a114`.
The 626,014-byte archive SHA256 is
`742bb96af380963b5af752ef2c622cfd5b11341e1c1b0809c69f30b07ceafa61`.

Maintainer English native-browser checks cover immediate routing after a short
child task is created, actual request download, owner-confirmed navigation-only
test-link binding, reload and exact full backup. Requests are version-bound;
changes to the plan, parent, destination or selected context invalidate stale
handoffs before copying or downloading. An occupied role is preserved, and
attachment requires an explicit boolean confirmation. Workspace hints remain
inert text; the assistant must resolve a permitted host workspace before acting.
The static browser does not execute native chat services or connect private APIs.
Owner data and existing project controls are not included in the public export.

For 0.15.1, eighteen anonymous HTTPS repository downloads matched the export
exactly without redirects. Public HTTPS installation, repeat hashes/modification
times and English/Russian world creation and repeat preservation passed at
installer commit `761f4547d48c0ff0fe2f7f15e4045d10b67cd523`.
The [fresh Ubuntu package check](https://github.com/kamenotes88/city-of-light/actions/runs/38340759038)
also passed at that commit. These results supersede the **NOT_RUN** CI/HTTPS
status at the preceding local checkpoint. A subsequent anonymous release-asset
readback matched the 0.15.1 archive and both manifests, while the 0.15.0 and 0.13.2
archives remained unchanged. [Tagged release CI](https://github.com/kamenotes88/city-of-light/actions/runs/38341311695)
also passed. These checks do not establish security certification or independent
customer acceptance. Native assistant execution from the browser is not implemented;
accounts, payments, online teams and signed automatic installation have separate
permission and acceptance boundaries.

Historical Pro preview 0.15.0 passed its local build and explicit `--check`.
Selected-history validation, bounded transcript streaming, atomic local storage,
conflict preservation and exact backup/restore have focused checks. Maintainer
native-browser verification includes large-history IndexedDB save/reload and
unchanged project state. Its archive is 610,942 bytes; SHA256:
`ce7fd740915c2f2cb38bb0da2f296cf57ca427fa4eae15704e2aed71e4ee22f1`.
Only explicitly selected local sources are read. Imported message excerpts are
inert observations; they grant no execution authority or accepted achievements.
Review text for private data before sharing a world or connecting an AI service.

Historical public Pro preview 0.13.2 passed its build and explicit `--check`: 23
JavaScript suites and 16 Python installer cases (15 passed; one OS-dependent
check skipped). Anonymous commit-pinned installation, repeat preservation and
fresh Ubuntu CI passed. Maintainer native browser checks covered seven views,
language reload, project creation, exact backup and separate restoration.
Archive SHA256: `3cc7c9c450d071ce706f37f35c252c2177a0446aaaede575d64d0b417049712f`.
The [historical package check](https://github.com/kamenotes88/city-of-light/actions/runs/38216447307)
uses installer commit `669ec53c92128fe7bd4e2a87afdaeaccd47e8866`.
These functional checks are not a security certification. Accounts, payments,
online team access and signed automatic installation remain not connected.

Historical accepted preview 0.12.2 passed its build and explicit `--check`: 19 JavaScript
suites and 16 Python installer cases (15 passed; one OS-dependent check skipped).
Source SHA256: `0297eaa66224ba7cdbc4d843903902f54ba82f0a4782fd401c2b6e0a0df0ca59`.
The archive is 380,452 bytes; SHA256:
`a43fe8d781a3228f01c39bbd5587e596a5ed30be908a647129237973fd4b4284`.
The published 0.12.2 package passed anonymous pinned HTTPS byte verification,
installation, repeat preservation and fictional English/Russian world creation.
The [fresh Ubuntu package check](https://github.com/kamenotes88/city-of-light/actions/runs/38187294438)
passed for installer commit `add74f832f62935ca58f008016b9033419ad2b92`.
Maintainer browser checks covered notification behavior, mobile layout and focus.
These checks do not establish independent user acceptance or a security certification.

Historical published preview 0.11.0 passed its local package checks and explicit
recheck. Its published package bytes, HTTPS installation, repeat preservation and
GitHub CI were also checked. Those older results do not accept 0.15.1. Automated checks
do not establish independent user acceptance or a security certification.
Support scope and fixes are stated for each concrete release. Compatibility
with every future system or indefinite maintenance is not promised.
