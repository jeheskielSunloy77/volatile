# Volatile

Volatile is an Electron desktop app for managing cache connections, workflow automation, observability, governance controls, and incident export workflows.

## Supported Release Artifacts

- Windows: Squirrel installer (`.exe`) and related update packages.
- macOS: ZIP archive (`.zip`).
- Linux: Debian package (`.deb`) and AppImage (`.AppImage`).

All release assets are built in GitHub Actions and attached to GitHub releases.
The GitHub Actions release pipeline uses `bun run dist`, which reads release targets from `electron-builder.yml`.

Releases are created automatically when the default branch contains a `package.json` version that does not yet have a GitHub Release. CI validates the current commit, creates or reuses the `vX.Y.Z` tag, builds the installers, and publishes the GitHub Release.

## Installation

### Windows

1. Download the latest Windows setup executable from the GitHub Release assets.
2. Run the installer and complete setup.

### macOS

1. Download the macOS ZIP from the GitHub Release assets.
2. Extract and move `Volatile.app` into `Applications`.
3. Open the app (Gatekeeper prompts may appear for unsigned builds).

### Linux

1. Download either the `.deb` or `.AppImage` artifact from the GitHub Release assets.
2. To install the Debian package:

```bash
sudo dpkg -i volatile_*_amd64.deb
sudo apt-get install -f
```

3. To run the AppImage, make it executable:

```bash
chmod +x Volatile-*.AppImage
```

4. Launch it:

```bash
./Volatile-*.AppImage
```

Linux auto-update support is available only when running the AppImage release. `.deb` installs do not support in-app updates.

## Verify Artifacts

Each release includes `SHA256SUMS.txt`.

```bash
sha256sum -c SHA256SUMS.txt
```

Run the command in the same directory as the downloaded release assets and checksum file.

## Development

```bash
bun install
bun run start
```

Useful quality checks:

```bash
bun run typecheck
bun run lint
bun run test:all
bun run check:release:readiness
```

## Security

See `SECURITY.md` for vulnerability reporting guidance.
