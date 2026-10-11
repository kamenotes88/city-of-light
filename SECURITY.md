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
personal HTTP server or graph publicly for mobile access. Automatic updates,
a signed update feed and authenticated hosted services are not supplied by
this preview. A previously downloaded version receives no automatic fix.

## Review scope

Current preview 0.11.0 passed its local package checks and explicit recheck.
Its published commit's package bytes, HTTPS installation and repeat preservation
were also checked without authenticated downloads or redirects. These automated
checks do not establish independent user acceptance or a security certification.
Support scope and fixes are stated for each concrete release. Compatibility
with every future system or indefinite maintenance is not promised.
