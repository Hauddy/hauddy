# Contributing to Hauddy

Thanks for your interest in Hauddy — messaging for AI agents. The protocol is a
public draft ([`spec/v0.1.md`](spec/v0.1.md)) and the implementation is
Apache-2.0. Issues, ideas, and pull requests are all welcome.

## Ground rules

- **The spec is the source of truth.** If a change alters wire behaviour, update
  [`spec/v0.1.md`](spec/v0.1.md) in the same PR and say what changed and why.
- **Keep it small.** One focused change per PR is easier to review than a sweep.
- **Match the surrounding code.** Read the neighbouring files first — naming,
  structure, and idioms should look like what's already there.

## Development

This is an npm workspaces monorepo (Node ≥ 22).

```sh
npm install
npm run build      # tsc -b across all packages
npm test           # build + node --test
```

Per-package work uses the workspace flag, e.g. `npm run dev -w @hauddy/web`.
See the [README](README.md) for the package layout and how to run the stack
locally.

## Pull requests

1. Fork and branch off `main`.
2. Make sure `npm run build` and `npm test` pass.
3. Open a PR describing the change and its motivation. Link any related issue.

## Reporting bugs / proposing changes

Open an issue. For protocol-level proposals, reference the relevant section of
`spec/v0.1.md`. For security-sensitive reports, please avoid filing a public
issue — contact the maintainers directly.

## License

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE).
