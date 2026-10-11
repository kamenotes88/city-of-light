# Optional early invitation records

Scope: `tooling`. Status: **PREPARED_LOCAL / NOT_PUBLISHED / NO_PAYMENT_FLOW**.
The free game is independent of registration. This bootstrap preserves early
invitation claims before an account/referral backend exists. It does not count
all downloads, installations or active users, and it does not award money.

## What ships at the launch boundary

- `invite.html` is a small standalone English start page with no tracking requests,
  cookies, external libraries, analytics, automatic account calls or redirects.
- `invite-registration.yml` is an optional GitHub issue form. Export it to
  `.github/ISSUE_TEMPLATE/invite-registration.yml`; enable repository issues.
- The exporter supplies **only the staged page's** `invite-config` JSON with the
  approved `OWNER/REPO` and an official HTTPS raw `INSTALL.md` URL pinned to a
  40-character commit. The source placeholders deliberately disable links.
- If GitHub Pages is explicitly enabled at `https://OWNER.github.io/REPO/`, the
  personalized entry is `invite.html?inviter=GITHUB_USERNAME`. Pages configuration
  is not performed by these files. Without Pages, the share button supplies a
  direct GitHub issue-form URL instead; installation is linked from the README.
- Opening the form only prefills the `inviter` input. Submission is the person's
  explicit action while signed into their own GitHub account. URL prefills use
  the form input's `id`, not GitHub's unrelated issue sidebar fields.

The invite query cannot change the official repository or installation link.
Only one syntactically valid GitHub username is accepted; duplicate or invalid
hints are ignored. Unsupported destinations, unpinned entries and incomplete
configuration disable links. Clipboard failure leaves selected text for manual
copying. Localhost/file links are never offered as public invitations.

## Public data and consent

The registration is public: GitHub's issue author and the supplied direct inviter
are visible. This is disclosed on the page and again in the form; submission
requires the acknowledgement. Do not request email, payment identifiers, private
project contents or unrelated personal data. Someone unwilling to publish that
relationship should skip registration and install free. A later private account
route needs its own consent and retention policy. GitHub keeps its own platform
records; this page cannot promise removal from copies of public material.

## Maintainer review, not automatic attribution

1. Read the original issue, its creation timestamp, edit history and actual
   authenticated author. Record GitHub's immutable numeric account ID rather
   than treating the editable username or claimed form content as identity.
2. Resolve the claimed inviter to the same stable account identity using GitHub
   records. Confirm the inviter actually exists; reject self-invitations and
   disputed, duplicate or demonstrably false claims. A syntactically valid
   username, supplied link or issue author name does not prove the relationship.
3. Keep the original issue as claim evidence, and append the review result with
   timestamp, reviewer and reason. Do not silently rewrite the original claim.
   Preserve claim states `claimed`, `reviewed`, `rejected` and later `disputed`.
4. For a future eligible seller, accept at most one direct inviter under published
   attribution terms. The applicable first eligible relationship must be confirmed
   before any settlement. Existing unresolved claims remain unresolved; an issue
   does not create a payout entitlement or freeze commercial terms.
5. Later import the evidence to a private backend. Preserve immutable account
   IDs, issue ID/URL, original creation time, edit/review evidence, reviewer,
   relationship status and applicable policy version. Import idempotently by
   repository + immutable issue ID. Keep subsequent corrections as dated events.

No recruitment reward and no commissions through unlimited referral levels.
The owner's proposed invited-seller allocation remains **75% seller / 20%
seller's direct inviter / 5% platform**. Registration does not activate those
terms. Approval, eligible sales, fee base, processing costs, tax, refunds,
disputes, attribution window, seller consent and settlement are separate gates.
Uninvited sellers and the owner's own paid tools require their own agreed terms.
New rates must be versioned and disclosed before they apply; historic paid
transactions and accepted rights cannot be silently recalculated.

## Count the correct thing

For an early launch, report unique **registered GitHub account IDs** after
deduplicating claims. Report reviewed direct-inviter relationships separately;
unresolved claims and repeats are not extra users. Issue count is not a user
count. GitHub traffic/release downloads are aggregate interest, not installation
or active-user proof. Manual/offline downloads may have no identity at all.

Once an optional backend exists, distinguish registered accounts, verified
installations, active consenting users, sellers, settled transactions and
payable referral amounts. An installation/device ID is not a person. Keep the
future stable account identity independent of editable usernames, client flags,
project data, free availability and payment provider IDs.

## Publication checks still required

Run `node launch-kit/test_invite_entry.cjs` locally. After the exact repository,
effective LICENSE/NOTICE and public contact are approved, test the deployed
HTTPS page (if used), template prefilling and a voluntarily submitted test claim
in that repository. Local tests do not establish hosted template behavior,
authentic identity, consent validity, attribution, payments or commercial readiness.
Do not advertise automated referral tracking or guaranteed future commissions.

Primary documentation:
[GitHub issue URL queries](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue),
[issue form schema](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-githubs-form-schema).
