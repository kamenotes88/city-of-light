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

The configuration has at most 32 sources. Native transcripts are read sequentially
with a reusable 64 KiB read buffer and a 128 KiB line buffer. Each selected native
read pass is limited to 1 GiB of scanned bytes and 30 seconds. A validated in-memory
append cache can follow a file whose total size grows beyond 1 GiB by reading
only its new bytes. The first import of an already larger file is refused;
export bounded documentary feeds for that source instead. Retained output is
limited to 10,000 messages. Each feed
is limited to 2 MiB; the container is limited to 10 MiB and 50 sources/chunks.
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
Restarting discards the in-memory append cache; a source already above the initial
1 GiB read budget then needs a bounded export rather than an unbounded re-scan.
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
