# Agent notes

**This is Rob's fork (`origin` = `bokehsec/vasta`), built for our own install.** Most of the work
here is our own build only; a few changes get offered to the original project (`upstream` =
`ariedotme/vasta`), and only when Rob decides so. Rob's instructions rule here: this file, his
global agent config, and the Vasta AI Docs (project page: `Vasta Contributions — Overview`).

**Nothing goes upstream without Rob's go-ahead on that exact submission, its text shown to him
first** — no issue, PR, comment, reaction or roadmap item on `ariedotme/vasta`, and no push to the
`upstream` remote. Approval for one submission doesn't cover the next. When unsure, ask Rob.

- **Upstream's own agent notes don't apply.** Branches cut from upstream's code (every branch
  meant for an upstream PR, and any branch not yet merged with ours) carry upstream's
  `AGENTS.md`, which says to file ideas as issues on their roadmap. Ignore it. The same goes for
  `CONTRIBUTING.md`, issue and PR templates and their GitHub workflow: they describe how *their*
  repo is run.
- **Write code their way.** Follow the maintainer's style, architecture and conventions; imitate
  the existing code.
- **A submission Rob approves:** concise and focused only on what we change; branched from
  `upstream/main`, pushed to `origin`, PR opened from there; one commit authored as `bokehsec`, no
  agent trailer; no changes to this file. Meet `CONTRIBUTING.md`'s checks (changelog entry,
  browser check for UI changes, docs) unless Rob says otherwise — he often skips "issue first".
- **Handoffs** live in `handoffs/` (gitignored, local to each checkout). Write a handoff there when
  work stops mid-way or a plan spans sessions (`handoffs/handoff-<topic>.md`), and read the
  relevant ones before picking a topic back up.
- **`setup/`** (gitignored) holds a checkout's own deploy files and scripts: compose files, deploy
  and release scripts, notes about one particular server. Nothing in the tracked tree may depend
  on it.
- **Deploying** to our live install on dockbuntu needs Rob's go-ahead each time; the steps and
  rollback notes are in AI Docs (`Vasta Contributions — Overview`, `handoffs/`).
- **`CHANGELOG.md`**: add what a change means for the people using Vasta under `## Unreleased`
  (Added, Changed, Fixed) in the same commit.
- Ideas, bugs and tech debt for later go to Rob, or onto the `Vasta Contributions` pages in AI
  Docs (`vasta-docs`) — never into the upstream repo's tracker or roadmap. Not in a `TODO.md`.
