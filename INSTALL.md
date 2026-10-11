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
3. How should the world look? Graph and path, also a game, or choose for me.
   Name, heroes, theme, success criterion, and first step can be suggestions.

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
template in a **new** file:

```text
node <engine-directory>/setup-world.cjs --locale-template <new-language-template.json>
```

Translate the values in `messages` into the human's language, set `language` to
its BCP47 code, and set `direction` to `ltr` or `rtl`. Put the full resulting
object in `answers.locale`. Keep every message ID, placeholder such as `{0}` or
`{1}` with the same count, HTML tag and attribute, and leading/trailing whitespace
or newline. Do not translate code, project IDs, names, or the user's source data.
The pack must contain the complete dictionary; partial translations are refused.
Values are text data, never scripts or an installation command.

The helper creates the template exclusively and refuses to overwrite a file.
It validates the selected pack before generating localized default stories,
helper text, and HTML, then preserves it in `world.profile.json`. Check the
rendered language in the browser when available. A structural pack test alone
does not confirm translation quality. Missing browser access remains a stated
limit; it does not justify replacing the requested language with English.

To include the original **Project World** skill for the selected assistant, add
`--assistant codex` or `--assistant claude` to the creation command. The optional
flag defaults to `manual`; that keeps the four-file world below. For example:

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

The output is `My-Project-World.html`, `world.profile.json`, `AI-HANDOFF.md`, and
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

Finish with the ready world's actual path/link, its first useful step, and the
few remaining connection actions. Report package integrity, world creation,
browser observation and source connection separately. Record only checks that
ran. New engine files stay separate from personal worlds and their history.
