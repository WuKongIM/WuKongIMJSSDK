# Changelog

## Unreleased

## 1.4.0-beta.1 - 2026-09-15

- Add pull-request and main-branch CI for the SDK build, type checks, lint and unit tests, plus `test:unit` for testing an existing build.

- Add opt-in message editing with automatic visible-channel update sync, version/restore-epoch merging, and latest conversation previews. Includes an authenticated HTTP adapter and a two-client browser example. CMD, SyncOnce, nonpersistent and stream messages remain non-editable.

- Publish prereleases under the npm `next` dist-tag, keeping stable `latest` unchanged. Requires WuKongIM v3.0.0-beta.17 for the complete companion release.
