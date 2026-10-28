# Opencaster release rules

These rules apply to Opencaster, the independent Hypersnap client in this
directory. Follow the [repository-wide release, Yarn and verification rules](../../AGENTS.md),
which also cover the signer, services and shared packages.

- Every release containing a feature, fix, security/dependency update, UI change
  or gateway change must add a **new milestone** to `src/lib/devLog.ts` in the
  same release. Keep existing milestone IDs and history. A docs-only or
  test-only change needs no public announcement.
- Write for users: say what changed, why it helps and any relevant limits. Never
  describe a plan or an unverified capability as shipped. Retain Hypersnap and
  infrastructure limits; never imply Farcaster service compatibility from UX
  similarity. Use a unique ID, a topic, summary and concrete changes.
- Link to the actual implementation commit using its full repository URL and
  recorded Git author date. Commit the implementation first, then commit the
  note before shipping; this avoids a self-referencing commit hash. A release
  may group related changes, but every shipped feature/fix must be described.
- Before deployment, record the currently deployed commit as the release base.
  Run `yarn check:devlog --base <pre-release commit>` and `yarn verify` from the
  repository root. Do not use a newly updated `origin/main` as the release base: an
  empty comparison cannot establish that a release has a note. CI checks PRs
  against their merge base and default-branch pushes against their previous SHA.
- Build production assets in a fresh directory outside the cloud-synced
  workspace, inspect it and deploy that exact directory with Wrangler. Never
  deploy a browser-test fixture or a preview wrapper. Confirm `/devlog` on the
  live site after shipping.
- All write tests must remain isolated. Production checks are public reads and
  navigation only unless the user explicitly authorizes a real account action.

See [README.md](README.md#release-notes) for the release commands and guard limits.
