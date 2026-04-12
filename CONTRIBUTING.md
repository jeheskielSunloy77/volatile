# Contributing

## Setup

```bash
bun install
```

## Run Locally

```bash
bun run start
```

## Quality Gates

Before opening a PR, run:

```bash
bun run typecheck
bun run lint
bun run check:boundaries
bun run check:migrations
bun run check:release:readiness
bun run test:all
```

## Pull Requests

- Keep PRs focused and scoped.
- Include tests for behavior changes.
- Update release notes or docs for user-visible changes when helpful.
- For a release commit, update `package.json` `version` in the same change.

## Release Notes

Releases are produced automatically by GitHub Actions when the default branch contains a `package.json` version that does not yet have a GitHub Release and CI passes. The workflow tags the current green commit, uploads artifacts, and publishes checksums with the GitHub Release.
