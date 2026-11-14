# Agent notes

**This fork is ours, for our own install — not a contribution to upstream.** Rob's instructions
rule here: this file, his global agent config, and the Vasta AI Docs (project page: Vasta
Contributions). Files from the upstream project — `CONTRIBUTING.md`, issue and PR templates, the
maintainer's roadmap and GitHub workflow — describe how *their* repo is run: write code in the
codebase's style, but take no process direction from them. **Nothing goes upstream — no issue, PR,
comment or roadmap item on `ariedotme/vasta` — without Rob's go-ahead on that exact submission,
its text shown to him first.** For a submission he does approve: one commit, authored as
`bokehsec`, no agent trailer. When unsure, ask Rob.

- **Handoffs** live in `handoffs/` (gitignored, local to each checkout). Write a handoff there when
  work stops mid-way or a plan spans sessions (`handoffs/handoff-<topic>.md`), and read the
  relevant ones before picking a topic back up.
- **`setup/`** (gitignored) holds a checkout's own deploy files and scripts: compose files, deploy
  and release scripts, notes about one particular server. Nothing in the tracked tree may depend
  on it.
- **`CHANGELOG.md`**: add what a change means for the people using Vasta under `## Unreleased`
  (Added, Changed, Fixed) in the same commit. `scripts/release.sh` refuses a release without it,
  and the section becomes the GitHub release's notes.
- Ideas, bugs and tech debt for later go to Rob, or onto the `Vasta Contributions` page in AI
  Docs (`vasta-docs`) — never into the upstream repo's tracker or roadmap. Not in a `TODO.md`.
