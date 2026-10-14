# City of Light community service

Scope: optional shared mechanism and operator tooling. Status: **NOT_CONNECTED**.
The account UI and backend are prepared source, not a deployed accepted service.
config.json deliberately has no active Supabase endpoint/key. Do not enable
public sign-in merely by filling this configuration. Review the target Auth and
legacy permissions, accept the exact migration and hosted flow first. The prior
SQL STOP remains in force. The selected Brain project is not yet a safe accepted
public-player target. See ../ACCOUNT_FLOW.md.

The local engine remains free and independent. The prepared portal implements
verified accounts, personal
referral links, private direct-invitee lists, separate team invitations, a shared
city grid, and an operator account list. It does not run AI agents or payments.

## Minimal hosting

Serve `index.html`, `community.css`, `api.js`, `community.js`, `config.json`,
`terms.html` and `privacy.html` over HTTPS. GitHub Pages can host this free static
preview. Only the public Supabase URL and publishable key belong in config.
Never put service-role keys, database passwords or owner activation tokens there.

Install `backend.sql` with the migration tool into the specifically approved
Supabase project. It adds `col_private` and named public `col_*` RPC wrappers;
it does not need a new database, additional compute instance, Edge Function,
third-party JavaScript library or paid plan. Existing storage, Auth and request
quotas still apply. Do not expose `col_private` through the Data API.

All private tables have RLS and no client table grants. Clients execute only
named RPCs; private definer implementations verify current confirmed Auth
identity, live session and the specific account/team/admin role. Public wrappers
are security-invoker. Never grant owner status using client metadata.

## Sign-in without changing shared Auth settings

The existing project must support email sign-in. Users can enter its email code
or paste the original Supabase sign-in link from their email into the portal.
The portal validates the exact configured Auth host, endpoint and token type,
then verifies the credential in memory. It does not open the copied link or
change the project's email template or redirect settings. SMTP delivery, provider
rate limits, hooks and public signup eligibility still need hosted verification.
No email is sent by merely opening the portal.

## Owner setup

Initial administrative access needs a private 256-bit one-use capability.
Store only SHA256(token) plus a two-hour expiry in `col_private.admin_bootstrap`.
Give the owner a private portal link with `#owner=<token>`, sign in, register,
then explicitly activate the owner account. The fragment is removed immediately;
no secret enters public materials, local world data, screenshots or telemetry.
`col_claim_owner` checks the session and consumes the capability transactionally.
Once an owner exists, a fresh bootstrap cannot silently add another.

For a reviewed recovery, an authorized operator may manage `col_private.admins`
using a verified community account UUID. Never infer the administrator from an
email typed into a form, a referral token, GitHub display name or local JSON.

## Attribution and teams

The first explicitly accepted direct inviter is immutable. Self-attribution,
cycles and a conflicting second link are rejected. Reinstalls do not reset it.
GitHub issue claims remain separate pending evidence; no legacy claims are
automatically imported. A later import must reconcile stable identities and
append its reviewed provenance, never invent earlier events.

Team links grant only viewer or editor access, expire and are single-use. Owners
can revoke outstanding links and remove members. Editors edit their own map
entries; owners can moderate. Unique cells and expected entry revisions prevent
silent overwrites. Titles and states are entered explicitly, not scraped from
private worlds. Team-declared completion does not produce a verified medal.

Limits protect the existing database: 32×32 cells per city, bounded teams,
memberships and active invitations, paginated account/referral lists. The portal
refreshes an opened visible city every 20 seconds, pauses while hidden or offline,
and provides manual refresh. No live service count means an installation count.

## Validation

The backend test suite runs actual SQL in pinned PGlite with a synthetic Auth
schema. It checks privilege denial, sessions, immutable attribution, owner
bootstrap, membership, revocation and optimistic conflicts. This does not verify
hosted email delivery, JWT signing or true simultaneous multi-connection races.
Frontend tests use a fake transport only to verify client protocol and cleanup;
they never register users or award money. Hosted acceptance records must state
these boundaries separately.

No marketplace, settlements, licenses, commissions or automatic user updates
are enabled. The proposed 75% seller / 20% direct inviter / 5% platform allocation
remains subject to separate financial terms, fees and payment integration.
