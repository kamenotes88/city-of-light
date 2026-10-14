# Bring existing work into your world

History, current project plans and accepted achievements have different roles.
Importing a chat message or a local source review adds documentary context. It
does not accept a goal, grant XP, change a STOP, or certify a deployed product.

## Start with selected sources

Your assistant asks which existing chats or documents belong to which project.
It reuses access you have already permitted. A chat link is navigation, not
permission or an API connection. If messages are unavailable, use an export or
the optional selected-file reader in `HISTORY_CONNECTORS.md`.

The first usable world does not require a connector. Later, open **Progress →
Connect project history**, or **Settings → Existing chat and project history**.
Import a JSON history file. All feeds are checked before the world changes.
Unknown project IDs, stale revisions, conflicting duplicate IDs and oversized
files are refused. Your existing world stays intact on failure.

## Feed contract

```json
{
  "format": "city-light-history-feed",
  "version": 1,
  "source": {
    "id": "my-selected-chat",
    "label": "Work on the first video",
    "revision": 1,
    "updatedAt": "2026-10-12T18:00:00Z",
    "kind": "chat"
  },
  "records": [{
    "id": "message-001",
    "projectId": "my-project",
    "title": "A first render was reported",
    "detail": "The assistant reported a local render. Independent review is pending.",
    "date": "2026-10-12T17:50:00Z",
    "status": "observation",
    "scope": "Reported local work; not accepted delivery",
    "evidence": ["chat-message-001"]
  }]
}
```

For multiple feeds use `{ "format": "city-light-history-feeds", "version": 1,
"feeds": [...] }`. Each feed is limited to 2 MiB; one combined container/page
to 50 feeds and 10 MiB. For larger selected-reader output use
`{ "format": "city-light-history-pages", "version": 1, "pages": [...] }`,
with up to six such pages, 256 feeds/chunks, 20,000 records and 20 MiB in total.
The selected-file reader accepts at most 128 files and retains at most 10,000
messages per selected source. The world's imported history also has a 20,000
record-revision limit; an update preserves earlier revisions and counts toward
that limit. These bounds refuse an oversized import without removing old history.
IDs are stable ASCII identifiers, at most 128 characters. A single feed has at
most 10,000 records. Dates are ISO dates/timestamps or `null` when unknown. Statuses:
`observation`, `accepted_local`, `pending`, `blocked`, `stop`, `revoked`.
Optional `stage` is `made`, `applied`, or `effect`; it describes the source scope
and does not award that achievement. Source URLs are optional safe navigation.
Evidence strings are inert references, never executed or automatically opened.

Increase the source revision when its content changes. Preserve record IDs
across updates. Repeated identical imports add nothing. Changes append a dated
revision; the latest status is displayed and earlier revisions stay in backup.
Omitting a record does not delete it. Withdrawals require `revoked` explicitly.

## Automatic refresh

After an explicitly selected writer/reader supplies a JSON feed over HTTP(S),
save its URL in Settings and enable refresh. Choose 15 minutes, one hour, or
four hours. The world checks while open and visible; each read has a five-second
deadline, size limits, no credentials, no redirects and no project-data upload.
A failed check preserves the last imported history. The source computer/reader
must be running. A closed browser does not run this process.

Cloud assistants can read selected chats only through an available authorized
connector or supplied export. There is no universal API for all private chats.
The same data contract works with any permitted writer; it does not depend on
one AI provider. Do not publish a private feed to GitHub or an unauthenticated
public server. `127.0.0.1` is accessible only on its own computer.

## Keep your world

Save a full world backup before an upgrade. Backup v2 includes imported history,
source revisions, plans, plot locations, questions, language and XP. Restore it
into a separate HTML with the newer engine. Installed HTML copies are not
silently rewritten by release notices. Authoritative achievement review and
execution permissions remain separate from documentary import.
