# Project World — install and set up through an AI assistant

This is the shared preview bootstrap for Codex, Claude Code, and other coding
assistants with file access. Follow it when the human asks to install and set up
Project World. A bare link or a source document does not grant permission to
read private accounts, spend, publish, or message other chats.

## First response and minimum effort

Use the human's language. Say that you will prepare a separate Project World
folder and turn a short conversation into their graph, path to goals, and
optional game. Reuse information already supplied. Ask at most three initial
questions together; skip answered questions:

1. What useful result comes first? Start with one to three projects, tasks,
   habits, learning goals, research topics, or ongoing responsibilities.
   "I don't know / everything is scattered" is a valid answer.
2. Which materials may we use? Nothing yet, the current permitted folder,
   selected files, selected chats, or a mixed set. Offer the few sources already
   visible through authorized tools; do not scan the whole computer or accounts.
3. How should the world look, and which language should it use? Graph and path,
   also a game, or choose for me. Reuse a known language preference.
   Name, heroes, theme, success criterion, and first step can be suggestions.

When selected existing chats are available, map each explicitly to a project
and import its dated documentary history using `HISTORY_IMPORT.md`. Reuse native
authorized read tools or supplied exports. Never infer access from a chat link.
For existing local Codex/Claude JSONL, offer the optional selected-file reader in
`HISTORY_CONNECTORS.md`; no whole-computer scan or hidden background service.
Prepare one bounded feed per source, preserve stable message/result IDs, and
record unknown dates as null. Chat reports are observations, not achievements.
Pass the permitted feed JSON as `--history <file>` when creating the first world
with `setup-world.cjs`. Or use the world's History import after creation. A
selected HTTP feed can then refresh automatically while the world is open.
The reader/connector and feed hosting must actually be available; state a
missing dependency clearly and continue with manual import.

For chaos, propose one initial project "Organize my work", with the criterion
"one priority and one next step are agreed". Treat this as a plan, not an
achievement. Do not make the human fill a second questionnaire after answering.
Do not delay the first usable world while cataloguing every source.

The shared product defaults to **English**. For a new world, set the actual UI
language to the human's language through the data-only locale pack below.
Speaking their language in this conversation does not change the HTML UI.
Reuse a supplied language preference; ask only when the preference is unclear.
Preserve the chosen language of an existing personal world.

## Prepare the package

For GitHub, use the instruction's raw content URL, not a `/blob/` HTML page or
a Release download redirect. Normalize a GitHub file link to
`https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>/INSTALL.md`.
If `<ref>` is a branch or tag, resolve it to its full commit SHA with an
available GitHub read tool or `https://api.github.com/repos/<owner>/<repo>/commits/<ref>`.
Read the instruction again at that commit and keep **all** sibling downloads
on that same commit. Never fetch the installer from a moving branch and the
archive from another version. If a ref cannot be resolved, report that blocker
and offer the browser archive fallback; do not claim a pinned install.

Determine only available capabilities: writable workspace, current OS, browser
or preview, existing Python and Node. Do not install Graphify, npm dependencies,
models, plugins, or a server for the initial world; the HTML has its own engine.

Resolve `install-release.json` relative to the instruction URL. If the entry is
the packaged `/portable/INSTALL.md` preview mirror, resolve it one level up.
The release record names the archive, exact byte count, SHA256 and file list.
Use the trusted distribution origin chosen by the human; checksum verification
is not a publisher signature. Do not replace it with an arbitrary mirror.
The public distribution must have the instruction, installer, release record
and archive in the same directory. Redirects remain refused by the helper.
Current `preview` records are local previews, not a commercial release or an
automatic update service. A localhost entry is reachable only in that machine's
environment; do not claim it is a public client link.

Use a dedicated layout in the writable workspace:

```text
Project-World/
  engine/<engine_version>/   # verified common files, no user projects
  my-world/                 # personal HTML, profile and handoff
```

If Python is already available, fetch the sibling `install-world.py`, inspect
it, and run it with a *new* engine directory:

```text
python install-world.py --release <resolved-install-release-URL> --target <engine-directory>
```

The helper downloads a bounded archive, verifies the ZIP and manifest, extracts
into a sibling temporary directory, and installs without replacing an existing
world. It never executes package code or connects accounts. Repeating the same
verified installation is allowed; a modified or unfamiliar target is preserved
and refused. If Python is unavailable, use the assistant's native download and
archive tools with the same size/hash/flat-file checks; do not install Python
just to unzip. Reject ZIP paths, links, duplicate or unexpected members.

## Generate directly from the conversation

With an available Node runtime, run the installed helper's `--verify` first.
Write the agreed answers as JSON in the permitted workspace. The input is the
existing `TownWorld.create` shape; the helper validates it through the installed
engine, so there is no second profile schema:

```json
{
  "world": {"name": "My workshop", "theme": "islands"},
  "goal": "Finish my first useful result",
  "limits": "Keep private data. No spending or publication without permission.",
  "projects": [{
    "name": "First project",
    "goal": "A result chosen by the owner",
    "criterion": "An observable condition agreed with the owner",
    "next": "One achievable next step",
    "activity": "project",
    "type": "general"
  }],
  "connectors": []
}
```

Supported themes: `islands`, `space`, `garden`. Activities: `project`, `task`,
`habit`, `learning`, `research`, `ongoing`. Initial preview: one to one hundred
directions. Omit optional fields to use existing engine defaults. Do not put
credentials, executable code, or fabricated progress in the answers.

For personalized improvements, a project may optionally contain `tags`, for
example `["software", "web-app"]` when the human has actually asked to develop
an application. Use at most 20 distinct lowercase labels from existing agreed
context. Do not infer software work from a building/hero or ask a new tagging
questionnaire. Preserve uncertainty: a speculative assistant classification is
discovery, not a declared tag. Existing profiles without tags remain valid;
editing another field preserves their previously supplied tags.

```text
node <engine-directory>/setup-world.cjs --verify
node <engine-directory>/setup-world.cjs --answers <answers.json> --output <new-personal-world-directory>
```

### Set the new world's UI language

Without `locale`, the helper creates an English world. English and Russian are
built in. To select Russian, add this field to the agreed answers:

```json
"locale": {"version": 1, "language": "ru", "direction": "ltr"}
```

Use `"en"` for English. For another language, create the complete English text
templates in **new** files. The common and Pro views have separate dictionaries:

```text
node <engine-directory>/setup-world.cjs --locale-template <new-language-template.json>
node <engine-directory>/setup-world.cjs --pro-locale-template <new-pro-language-template.json>
```

Translate the values in `messages` into the human's language, set `language` to
its BCP47 code, and set `direction` to `ltr` or `rtl`. Put the full resulting
common object in `answers.locale` and the full Pro object in `answers.proLocale`.
Both must use the same requested language and direction. Keep every message ID, placeholder such as `{0}` or
`{1}` with the same count, HTML tag and attribute, and leading/trailing whitespace
or newline. Do not translate code, project IDs, names, or the user's source data.
The pack must contain the complete dictionary; partial translations are refused.
Values are text data, never scripts or an installation command.

The helper creates each template exclusively and refuses to overwrite a file.
It validates the selected pack before generating localized default stories,
helper text, and HTML, then preserves it in `world.profile.json`. Check the
rendered language in the browser when available. A structural pack test alone
does not confirm translation quality. Missing browser access remains a stated
limit; it does not justify replacing the requested language with English.

The browser wizard starts in English and offers English/Russian before creating
a world. Inside a Pro world, Settings can change those languages or import a
complete combined `{locale, proLocale}` JSON pack. Settings can export the
English combined template for the assistant to translate. Changing UI language
does not rename projects or translate their history.

## Full public Pro world

New worlds use the public Pro interface: City, Adventure, Progress, Decisions,
Teams, Tools and Settings. Plans, plot selection, heroes, local learning XP,
human attention records and evidence share one state. A project starts as a
draft; neither playing nor creating a chat link proves real-world execution.
The relationship map opens from Settings. Existing world backups remain
compatible with their original view; they are never silently recreated.

Use Save world or Settings to export the full `city-light-pro-backup` version 2
JSON. It preserves the current state, plans, plots, questions/answers, history,
language and imported graph/material context. Restoring through Start.html or
Settings downloads a separate HTML world, leaving the current copy intact.
The checksum detects damage; it is not a publisher signature or encryption.

There is no automatic owner-source connection in a new world. If explicitly
requested, Settings accepts a full Pro-state JSON snapshot for the same world,
with a valid `source.asOf` date, from a chosen HTTP(S) URL or a manual file.
Only selected projects synchronize. Source checks run while the world is open,
use the selected project intervals, omit credentials and refuse redirects,
and stop after five seconds or five MiB. They do not read chats or authorize
an AI to execute a task. A selected source controls incoming evidence and
questions, so choose it as carefully as the underlying project record.

To include the original **Project World** skill for the selected assistant, add
`--assistant codex` or `--assistant claude` to the creation command. The optional
flag defaults to `manual`; that keeps the six-file world listed below. For example:

When the current assistant is known to be Codex or Claude Code, use its matching
option within the permitted new-world folder; no extra questionnaire is needed.
For another assistant, use manual mode and read the same skill as instructions.

```text
node <engine-directory>/setup-world.cjs --answers <answers.json> --output <new-personal-world-directory> --assistant codex
```

Codex receives `my-world/.agents/skills/project-world/SKILL.md`; Claude Code
receives `my-world/.claude/skills/project-world/SKILL.md`. Open `my-world` as the
assistant's project to use it. The helper copies the verified
`project-world-skill.md` without edits and records its hash and assistant choice
in the receipt. It writes no user-wide skills, hooks, account configuration, or
files outside the new world. Report creation separately from observed assistant
discovery. Manual mode can read the skill as ordinary instructions.

Project skill locations follow the official
[Codex skill documentation](https://learn.chatgpt.com/docs/build-skills) and
[Claude Code skill documentation](https://code.claude.com/docs/en/skills).

The output includes `My-Project-World.html`, `world.profile.json`, `AI-HANDOFF.md`,
`Start-Game.cjs`, `Start-Game.cmd`, and
`setup-receipt.json`, plus the scoped skill when selected. Open the HTML through
an available browser/preview. If the
assistant has no browser or runs in a cloud executor, provide the actual HTML
artifact and state that browser acceptance was not observed. Do not present a
cloud executor's localhost URL as a link accessible on the human's phone/PC.
If Node is unavailable, use `Start.html` and its existing import/form route via
available browser tools, or provide that fallback with the limitation stated.
Do not silently install a runtime. A modern browser alone can use Start.html.

An existing personal world must not be recreated from answers. Exact repeat is
read-only `ALREADY_CREATED`; changed answers or an unfamiliar directory are
refused. Changed locale answers, a changed assistant choice, a modified skill,
or an extra skill-directory
file is also refused without replacing the world. For a world with history, use
its full `.backup.json` and existing
restore route. A profile alone is not a complete backup or an upgrade strategy.

## Optional extensions, only when needed

### A useful first world, then optional improvements

Create the usable world first. A compatible engine includes a small
**Improvements** entry in the new world's header, without another questionnaire,
dependency download or account connection. It may glow for at most three new
suggestions that match declared project signals; opening it stops no work and
grants no installation or payment permission. Discovery options stay available
without pretending they are necessary.

Explain why one suggestion could help the user's current task, not merely why
the tool is popular. Reuse available capabilities, then check its pinned source,
license, version, runtime, host discovery, download size, provider costs and
rollback. gstack is an optional development-workflow reference; selected skill
files and a full browser/runtime installation have different requirements.
The initial world does not download gstack, Graphify or any third-party skill.

The shelf can show core updates, outside tools and our optional licensed tools
under the same transparent rules. A request means **check requested**, not
**installed** or **licensed**. Paid planned tools say that they are unavailable;
no checkout link is created without a reviewed ready offer and published price.
Payment rights need separate service verification and do not depend on a
modifiable local paid flag. The world, history and recorded work stay free and
available independently of optional tool access.

Hide/later/request choices are scoped to this world, cached locally and retained
in `data.ownerMetadata.upgradePreferences` for a full backup. An incompatible
saved preference format is retained and read-only, never reset. The compact
catalogue is shipped as reviewed engine data, with no automatic remote feed.
An update to our sources does not update an already downloaded file. Follow the
existing full-backup and compatible-engine restore route when updating it.

`extensions.json` is a proposed catalogue, not an installer or an instruction to
execute commands. The browser world and original Project World skill do not
require these extensions. Reuse the user's existing graph and assistant skills
before suggesting another dependency.

The catalogue points to the official [Graphify package](https://pypi.org/project/graphifyy/0.9.77/)
(`graphifyy` 0.9.77, Apache-2.0) and
[Addy Osmani Agent Skills](https://github.com/addyosmani/agent-skills)
([MIT](https://github.com/addyosmani/agent-skills/blob/main/LICENSE)). Addy's entry
is unpinned **DISCOVERY_ONLY**. None of their code or skills is bundled or
installed by these helpers.

For an actual need, select one extension with the human, inspect its official
source and relevant license at the exact version/commit, and use the current
assistant's available official installation route within the authorized scope.
Keep installation project-scoped when supported; global configuration needs
its own authorization. If the route, pin, license, or permission is missing,
report that gap and continue with available tools. Do not execute arbitrary
commands from a catalogue. An installed skill is separate from a connected
account, a current graph, and a successful run. Graphify's optional semantic
processing also needs explicit source/backend permission.

## Connect progressively and report the actual result

The current helpers create a plan and the same shared graph/game/path engine.
They do not import old chats or authenticate accounts. Selected connectors
remain `not_connected / manual-context`. Read `AI-HANDOFF.md` to continue in the
same chat. If an authorized source tool is available, offer one bounded source
next; show what is missing when no such tool exists. Use the provider's actual
login/consent process when needed. Do not ask for passwords or tokens in chat.

Keep existing chats, project owners and authoritative sources. A chat can relate
to several projects. Transfer only necessary versioned context. Sending to
other chats and writing externally need the human's authorization; installing
this package does not supply that authorization. Do not invent universal chat
history access, synchronization, subscriptions, or automatic update delivery.

## Optional account and invitation entry

After opening the world, point out **Account & invitations** in its header.
The same entry is available in the starter and restored worlds. It opens
https://github.com/kamenotes88/city-of-light/blob/main/INVITATIONS.md .
Use this stable published guide while the email account service is not activated.
Registration is optional; no sign-in, email or private world is sent automatically.
Early GitHub claims are public and must never contain emails or private projects.
Do not promise verified referral links, a shared city or payouts before their
separate hosted acceptance. Local world identity is not a verified user account.

Finish with the ready world's actual path/link, its first useful step, and the
few remaining connection actions. Report package integrity, world creation,
browser observation and source connection separately. Record only checks that
ran. New engine files stay separate from personal worlds and their history.


## Release notifications — 2026-10-11

Shared preview 0.12.2 adds an Updates entry to Start, created/restored worlds and
the private Pro. At most one automatic attempt per 24 hours is made while open
and visible; failures are throttled too. Manual checks are available and the
automatic setting can be turned off. The only remote request is anonymous GET
to https://raw.githubusercontent.com/kamenotes88/city-of-light/main/update-notice.json.
Project data, world/account IDs and email are not sent. GitHub sees ordinary
connection information such as IP. Offline gameplay is unchanged.

`world-update-core.js` validates numeric versions, schema/product/channel and
calendar dates. `world-update.js` enforces a five-second deadline and an 8192-byte
stream limit, refuses redirects and creates the release link from a validated
version only. The feed supplies plain text, never executable code or URLs.
No popup interrupts a mission; choosing the Updates dialog pauses the mission
and does not change its progress. Close it and resume when ready.

`update-notice.json` is publisher tooling; update it only after the
matching public release and assets exist. Keep its version equal to that public
release. The local catalogue still ships with the engine. Notifications do not
install, migrate, authenticate, pay or automatically deliver improvements.
Signed installations and full migration acceptance remain separate gates.

## Continue a real project with your assistant

After creating any task, **Connect executor** is its immediate next step.
Choose an existing parent project or an independent task. Then attach an
existing chat, or ask your current assistant to create one in the appropriate
saved workspace. Workspace hints are optional; the assistant should inspect
available saved projects and reuse existing context before asking you.

Copy or download the version-bound `chat-launch-request.json`. Your assistant
uses supported native host tools where available and returns the actual chat
title/link with the request binding. Confirm that link in the same dialog.
Changed plans or destinations refuse stale results; existing roles are kept.
The browser does not call private host APIs, create chats by itself or claim
that attaching a link starts autonomous execution. When a host lacks the
required connector, the same request provides an explicit manual fallback.
This route works for new tasks and previously unlinked projects. Full backup
preserves the selected parent, workspace hints, request and chat attachment.

The local Work with AI button is available in every public Pro view. Select
one project, agree its plan, and copy its next-step request to Codex or Claude.
The request contains only that project's binding, goal and current next step;
it grants no new production, spending, private-chat or publication authority.

Your assistant returns a bounded data-only report. The installed
`work-report.schema.json` defines the format; the verified engine provides:

```text
node <engine-directory>/work-result.cjs --request work-request.json --claim claim.json --output report.json
node <engine-directory>/work-result.cjs --check report.json
```

Optionally add `--artifact <regular-local-file>` to record its SHA256. No file
is executed or uploaded. Existing output is preserved; changed reports require
a new filename and report ID. A checksum records bytes, not result quality.

In Work with AI, import the report, inspect its scope and evidence, then accept
or reject it. Import alone creates no achievement. A checked partial step can
advance the next action while the goal stays in progress. Completing the whole
goal requires a separate confirmation. The graph, city and statistics read the
same saved record; repeat imports do not award the same result again. Export a
full world backup before switching devices or restoring. Linked external
projects continue accepting results in their authoritative source.

The offline workflow needs no accounts or database. The optional local native
runner adds explicit Codex execution for game-created tasks; it does not take
over existing Desktop chats or automatically deliver engine updates.

## Start the game with local AI

For newly created worlds, open **Start-Game.cmd** on Windows, or run
`node Start-Game.cjs` on another system. The launcher starts a local-only server
and opens its browser address. Leave its terminal running while using local AI.
It makes no model call merely by opening the game. If Node or Codex is not
available, ask your installation assistant to inspect the available runtime;
missing providers are never silently installed or billed.

Inside **Work with AI**, connect the local runtime, agree the plan, select the
workspace, and click **Start approved step**. The first version uses one
executor for a game-created project. It creates a separate game-owned Codex
chat; a link to an existing Desktop chat is not execution access. The workspace
must match the directory explicitly chosen when starting the runner.

For a world already used under `file://` or another local server address,
export a **fresh full world backup** from that currently used world first.
Restore it into a separate HTML with the current engine, verify all backup
sections, and launch that restored copy. Browser storage belongs to its origin;
opening the old generated HTML on another port loads its embedded snapshot,
which may be older than current browser changes. Keep the original world and
backup until the new copy has been checked. The runner does not silently migrate
browser storage or overwrite your old world.

After that guarded migration, your authorized assistant can start:

```text
node <engine-directory>/run-world.cjs --world <exact-world.html> --world-id <world-id> --workspace <authorized-directory> --open
```

`--codex <verified-executable>` selects an already installed Codex binary.
`--read-only` permits connection/status checks and blocks work dispatch.
The runner listens only on 127.0.0.1 (default port 8899). Its temporary bearer
stays in browser/session memory and is excluded from world backups. Normal
agent work consumes the connected provider's tokens; lightweight status checks
do not call a model. The runner disables inherited MCP servers only for its own thread and verifies
their native disabled status with empty tool/resource catalogues before work.
Your normal Codex plugin configuration is preserved. Native permissions that
require owner approval stop with an explicit message. No permissions are
automatically granted.

Completed reports arrive as pending evidence for manual review. A report is not
an accepted result, and a partial step does not complete the whole goal. The
same command cannot be submitted twice for a second reward. After a crash with
an unknown submission outcome, check the existing chat before any new launch;
the runner will not automatically replay that work. Existing file-history
imports and manual handoff remain available without the runner. Claude native
execution and control of already-running Desktop chats are not connected by
this version.

## Live selected history and reviewed stages

For permitted existing chats, your assistant prepares an exact local reader
config with selected Codex/Claude JSONL or structured feed paths, stable source
IDs and explicit project mappings. It must use a dedicated output outside the
generated world. Pass that existing config as `--history-config <absolute.json>`
to setup or to `run-world.cjs`. Nothing scans all your chats or uploads their
contents. Files available only in the cloud require a permitted connector or
export; a navigation link alone cannot read them.

One local worker reads changed selected files. One authenticated foreground
event stream lets the game fetch changed complete chunks and save them together
before updating graph, city, progress and missions. Reopening catches up from
saved source fingerprints. **Refresh chat/history** is a manual check without a
model call. Offline or invalid input keeps previous history. The bounded preview
supports 100 projects, 128 selected files, 256 chunks, 20,000 retained records
and 20 MiB per imported batch. A larger source needs selected history or an
explicitly prepared export; it is never silently truncated into a claimed full
history. Watching and rendering use CPU and memory even though they use no AI
tokens. New records remain observations, never automatic awards or authority.

Use **Suggest/improve plan with AI** for a bounded proposal. Review it, apply it
as a draft, edit its independent stages and completion criteria, then approve
separately. Approval does not start a worker. Select a stage when starting an
approved work step. The report first appears as pending evidence. Accepting a
partial step gives no completed floor; a separately verified complete stage
gives one floor. Renaming, reordering, repeating imports or expanding the same
project does not award that stage twice. Revoked last proof reopens the stage.
Short tasks remain city objects. Rendering shows at most 50 detailed floors;
the exact approved/confirmed counts and all stages remain available in Progress.

After a runtime restart, an old game-owned chat stays in history. If its prior
run has a known terminal receipt, an explicit reconnect can create a new
executor for a genuinely new approved step. Unknown outcomes block dispatch;
do not resume an unrelated Desktop chat or repeat its work. Existing-source
projects retain their original roles and acceptance route.

