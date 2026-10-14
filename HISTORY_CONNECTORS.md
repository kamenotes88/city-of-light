# Connect existing project history

City of Light can import documentary history from one or several explicitly
selected sources. The same imported records support the graph, game and progress
view. A chat message is reported information. It never becomes an accepted
achievement, completes a goal, grants XP or authorizes work through this import.

## Choose the connection available on your host

| Available source | Connection |
| --- | --- |
| A selected local Codex conversation stored as JSONL | `codex-jsonl` reader |
| A selected local Claude Code conversation stored as JSONL | `claude-jsonl` reader |
| A reviewed data-only history feed produced by your assistant or exporter | `feed-json` reader, or direct history import |
| A cloud chat readable through an authorized provider tool | Ask that assistant to export a structured history feed and keep that feed current |
| A chat that this assistant cannot read | Export the selected conversation first; a chat URL alone does not grant access |

The reader does not discover all chats, inspect account folders, read credentials,
send messages, run instructions from transcripts or connect to a remote service.
Your assistant identifies the exact files you choose, maps each selected source
to one of your existing project IDs, and prepares the configuration. Projects,
source IDs and file paths must be explicit; there is no automatic project guessing.

## Minimal local setup

Use Node.js already available on your host. Keep `history-source.cjs` and
`world-history-core.js` together. The verified installer supplies these files;
the reader does not install a runtime or register a system service.

Create a configuration file outside the files being imported. Replace the
example absolute paths and project ID with your actual selections:

```json
{
  "version": 1,
  "sources": [
    {
      "id": "my-video-chat",
      "label": "My video project conversation",
      "projectId": "my-video-project",
      "provider": "codex-jsonl",
      "path": "C:\\MyWorld\\selected-video-chat.jsonl",
      "url": "codex://threads/00000000-0000-0000-0000-000000000001"
    }
  ],
  "output": "C:\\MyWorld\\history-feed.json",
  "intervalSeconds": 60
}
```

On macOS/Linux, use absolute local paths such as
`/home/alex/MyWorld/selected-video-chat.jsonl`. For another chat, add a source
with its own stable ID and exact project mapping. The output parent folder must
already exist. Output must differ from every input and the configuration itself.
Input/output paths cannot be URLs, network shares, directories or symbolic links/junctions.
For native transcripts, an optional explicitly supplied `url` adds navigation to
the selected chat. Replace the example UUID with your chosen chat's real link,
or omit `url`. It accepts HTTP/HTTPS, `codex://` or `page://` navigation without
embedded credentials. A navigation link grants no authentication or access to
messages. Links are never inferred from file paths or fetched by the reader.
Structured `feed-json` sources retain their own validated `source.url`.

Read once:

```text
node history-source.cjs --config <absolute-path-to-config.json> --once
```

Optional automatic reading while this foreground command is running:

```text
node history-source.cjs --config <absolute-path-to-config.json> --watch
```

Ctrl+C stops the reader. The interval can be 30–3600 seconds. Unchanged files are
checked by metadata and are not reread; unchanged output is not rewritten. An
updated source produces a new data feed. This process performs no AI calls and
does not create an additional database.

Open **Settings → Existing chat and project history**, then use **Import history
JSON** to import `history-feed.json`. For automatic browser refresh, enter the
explicit URL under **My history source URL**, select the interval (15 minutes,
1 hour or 4 hours), enable the automatic option and choose **Save history
connection**. **Check history now** performs an immediate selected-source read.
The file must be served by your existing local host under that host's allowed
route; the reader does not create a server.
The browser's selected-source refresh and this file reader are separate steps.
Neither step starts project execution or connects an unavailable cloud chat.

When an assistant runs on another host, it must use that host's authorized
exports or provider tools. A `127.0.0.1` URL refers to the device opening it;
sharing that URL does not share your desktop files.

## What is imported and retained

- Codex `response_item` messages and Claude user/assistant messages contribute
  visible text excerpts only. System/developer messages, metadata, tool calls,
  tool output and reasoning/thinking blocks are excluded.
- Each record has a stable message identity, project ID, source reference,
  original recorded date when available, a title, an excerpt and an explicit
  observation scope. Missing or invalid dates remain unknown.
- Native chat excerpts are capped at 900 characters and titles at 180 characters. Markup
  brackets and active scheme text are converted to inert text. Instructions
  quoted in messages remain text and cannot trigger actions.
- The feed contains no local source path. Selected excerpts themselves can
  contain private project information; keep the resulting feed in your own
  world and outside a public release package.
- Native IDs, or a SHA-256 identity derived from timestamp/role/text, avoid
  duplicates after an append or repeat import. These hashes identify content;
  they do not authenticate a claim.
- A source revision advances only when its visible records or metadata change.
  Unchanged chunks keep their previous revision and date. When no message has a
  recorded timestamp, the source check date uses the local file modification
  time; individual message dates remain unknown.
- Previously imported records remain in the output when a transcript is
  shortened or a structured delta omits them. Editing a native message creates
  updated documentary content under the same stable identity; the world's
  import retains its previous revision in history.

Do not change a source ID or project mapping merely to import the same chat
again. To deliberately detach a source, disable its browser connection and keep
the existing history/backup. The reader refuses to replace an output containing
sources removed from its configuration; use a separate new output for a new
selection, while retaining the previous history file.

## Structured feed contract

A reviewed exporter can produce:

```json
{
  "format": "city-light-history-feed",
  "version": 1,
  "source": {
    "id": "reviewed-project-source",
    "label": "Reviewed project source",
    "revision": 1,
    "updatedAt": "2026-10-12T12:00:00Z",
    "kind": "document"
  },
  "records": [
    {
      "id": "review-note-001",
      "projectId": "my-video-project",
      "title": "A local draft was reviewed",
      "detail": "The draft exists. Customer delivery has not been checked.",
      "date": "2026-10-12",
      "status": "observation",
      "scope": "Documentary report only; no accepted customer result.",
      "evidence": ["Selected review note 001"]
    }
  ]
}
```

`source.kind` is `chat`, `document` or `timeline`. The record statuses are
`observation`, `accepted_local`, `pending`, `blocked`, `stop` and `revoked`.
`accepted_local` describes the exact local documentary scope; it is not a game
medal or production/customer acceptance. An optional record `stage` distinguishes
`made`, `applied` and `effect`. Evidence references are inert and are never fetched.
Project/source IDs must match the explicit mapping. Unknown fields and prototype
keys are refused. Core source revisions are monotonic; a stale/conflicting import
is refused without changing the world.

The reader writes a versioned container:

```json
{
  "format": "city-light-history-feeds",
  "version": 1,
  "feeds": []
}
```

Native conversations are split into stable sources such as
`my-video-chat:part0001`, with at most 200 records per chunk. Each chunk follows
the structured feed contract. A `feed-json` input already follows that contract;
its source ID and all record project IDs must match the selected configuration.
The reader retains its imported records and owns the output revision stream.

## Limits, failure and recovery

The configuration has at most 128 selected source files. Native transcripts are read sequentially
with a reusable 64 KiB read buffer and a 128 KiB line buffer. Each selected native
read pass is limited to 4 GiB of scanned bytes and a 30-second deadline in the
current reader. These are upper safety bounds, not an expected workload or a
promise that a large scan completes. A validated in-memory append cache can
follow a larger file by reading only its new bytes within that pass budget.
A first import above the reader's budget is refused; export bounded documentary feeds for that
source instead. Retained output is limited to 10,000 messages per selected source
and 20,000 records across all sources, with at most 256 feeds/chunks. Each feed is
limited to 2 MiB. Each output page holds at most 50 feeds and 10 MiB; a paged
output has at most six pages and 20 MiB in total. Storage uses compact JSON
without changing record IDs, source revisions or cursor lineage.
These are refusal limits, not a rule to silently discard old history.

Tool, system and reasoning records are excluded. Oversized records are scanned
and discarded without retaining their full text. A recognized oversized visible
message produces an explicit observation that its complete text was not imported;
it never becomes an achievement. CLI diagnostics report visible message counts,
oversized visible/other records, excerpt truncations, bytes read and incomplete
trailing lines. Full original message text remains in the selected source file.

Optional watching keeps parsed excerpts, file identity and complete-line offsets
only in memory. Unchanged files are not streamed again. Append-only growth reads
new bytes after checking the saved prefix's first/last 64 KiB fingerprints.
Truncation, replacement, a changed size-stable file or a mismatching fingerprint
causes a full bounded re-read. Those anchors are an optimization for native
append-only logs, not proof that an arbitrary middle-of-file rewrite did not occur.
Restart the reader after external transcript rewrites to force a full re-read.
Restarting discards the in-memory append cache; a source already above the
current reader's initial 4 GiB pass budget then needs a bounded export rather than
an unbounded re-scan.
Incomplete trailing JSON waits for later appended bytes; malformed complete lines
still refuse the pass. No cursor sidecar or background service is created.
Each native pass freezes the file size observed when it opens the selected chat.
If that same file only grows while it is being read and the frozen prefix's
boundary fingerprints remain unchanged, the current pass imports that prefix;
the next pass reads the appended bytes. The new size is not marked as already
read. Truncation, replacement, size-stable edits and changed boundary fingerprints
refuse the pass and preserve the previous output.

The output is written to a new temporary file, flushed, checked for concurrent
changes and replaced atomically. A malformed complete line, unsupported source,
size/time limit, destructive change during a read or output conflict retains the previous output and returns
an error. Optional watching reports a changed error once and retries on its
normal interval; it never removes existing records to make a limit pass.

For a large conversation, ask the authorized assistant to export bounded
documentary feeds for explicitly selected periods or milestones with distinct
stable source IDs. Keep the original transcript and the previous world backup.
The bounded history importer does not promise to ingest unlimited raw text.

Before updating your world, download a full world backup. Core history import is
atomic and never promotes documentary records into rewards. Restoring your
backup uses a separate world namespace; it does not modify the source chat or
an existing project database.
# Lightweight refresh and manual chat verification

The **Refresh chat** button checks the configured history feed for the selected
project and reports when the file was checked, its source date and whether the
selected chat links have matching imported sources. It never claims direct chat
access from a navigation link. If a chat is absent from the feed, it offers a
read-only request to the user's authorized assistant. It does not create or wake
chats, execute work, grant acceptance or spend provider tokens itself.

Automatic refresh stays opt-in and foreground-only. It makes one request to the
configured combined feed, rather than one AI request for each project. Successfully
validated and durably imported responses may supply ETag/Last-Modified validators.
A valid unchanged 304 response has no history body, JSON parsing or merge. A
changed response retains the existing size, schema and atomic-storage guards.
Servers without validators still use the bounded, duplicate-safe import path.
Concurrent clicks share the existing single-flight guard; automatic failures
back off up to four hours. Manual checks bypass the delay and display errors.
The browser keeps only small cache metadata and a reference to its current
context; it does not retain another full raw history response.

This file check makes no language-model call and consumes no model tokens. It
still uses a small amount of CPU, memory and network traffic; provider connectors
may have their own quotas, fees or limitations. Running project agents remains
separate from synchronization and may consume tokens. Reading a ready feed does
not force the upstream reader to run or guarantee current external chat state.

The profile supports up to 100 projects, but that is not a promise of unlimited
chat sources or history. Existing feed/record/byte limits remain. Large portfolios
should use compact current-status summaries and selected incremental history,
with paused work checked less frequently. Source freshness and checked evidence
are separate from the owner's acceptance of made/applied/effect results.

## Concurrent checks and reader revisions

A project-source response is applied only while its world, configured URL and
the checked projects' goal, plan, next step, blocker and source date still match
the request. Movement, learning and independent project edits do not invalidate
the check. A refused stale response preserves current work and can be checked
again against the current source. Returning to a cached page resumes the existing
refresh mechanism; other-tab notifications read the latest durable state rather
than trusting an older queued notification.

Structured `feed-json` reader inputs keep their original revision, normalized
SHA-256 and date in optional `readerInputCursors` metadata inside the existing
atomic combined file. This metadata is not another source, history record or
achievement. Lower revisions, conflicting contents at the same revision and
backward source dates refuse the pass, including after a reader restart. Use
the matching updated reader and engine (0.15.5 or later) together; ordinary v1
feeds and native JSONL output remain supported. An older structured aggregate
without an input cursor is retained unchanged by normal checks. After backing
up that file, run the one-shot `--initialize-structured-cursors` option against
the same selected config/output. It adds only cursor metadata when all selected
structured records, kind and URL exactly match retained output and dates do not
go backward. Prior output revisions, native feeds and record order remain
unchanged. Mismatch refuses the entire write; keep both inputs for review rather
than resetting source IDs or output revisions. Repeat initialization of the same
known input is idempotent; it never replaces an existing cursor.

An opened report review captures the relevant work state. Changed evidence,
plan, goal, next step, blocker or chat requires a fresh review. An old report can
be explicitly declined with a reason but cannot apply an obsolete next step.
Revoking a partial or older-goal result preserves independently proven current
completion. Revoking the last proof of the whole current goal reopens it; a
different corrected artifact can complete it after a new review. The old revoked
identity stays revoked and cannot earn a second reward.

Updates add interface messages. Built-in English/Russian catalogues are paired
with the engine. A custom translated backup must supply all messages required
by the target version; incomplete packs are refused without changing the backup
or current world. Keep the old package and ask the assistant to translate the
new complete template before a separate restore. Transparent custom-language
migration is not yet implemented.

## Archived projects and unavailable chats

Project archiving is a reversible local visibility choice. Shared source refresh
preserves that choice, and missing chat data never removes the project. History
can be inspected with the Archive/All project visibility filters in Progress.
The full backup includes lifecycle records and previous chat connections.

An omitted source-role link remains stored with an explicit source-not-reported
marker. The owner can report unavailability and choose a different actual chat
for that role. Old links, availability notes and captured handoffs remain in
history. An unavailable marker remains separate from source status and project
completion. Automatic native-chat disappearance checks require a supported,
authorized provider connector; they are not implemented by this file importer.

## Optional same-origin live delivery

The unified local runner accepts one exact existing `--history-config`. Its
worker watches the selected files, uses incremental reader cursors and keeps
the dedicated output's last valid revision after an error or restart. A single
worker pass has a separate 60-second deadline for all selected sources; an error
retains the prior output and a timed-out worker requires a runner restart. A single
authenticated foreground SSE connection advertises bounded source chunks.
The browser requests only changed whole chunks by their advertised generation,
revision and canonical fingerprint. A changed generation refuses the batch and
triggers a fresh snapshot; changed world/plan/routes/lifecycle refuses stale
application. All validated chunks persist together into the existing world
context before its views refresh. Importing twice adds zero duplicate rows or
awards. Hidden tabs pause delivery and catch up when they return.

Manual refresh reads current selected source data without invoking an AI model.
This verifies reader freshness, not cloud execution, accepted progress or chat
deletion. The preview bounds are 128 selected source files, 10,000 retained
messages per selected source, 256 chunks, up to six pages of at most 50 feeds
and 10 MiB each, 20,000 retained rows and 20 MiB in total. Reader output above one
container uses `city-light-history-pages` v1 with `pages` holding the existing
closed `city-light-history-feeds` containers. New output pages do not reset
source lineage. Legacy cursor initialization remains an explicit exact-match
operation; errors preserve the original.

