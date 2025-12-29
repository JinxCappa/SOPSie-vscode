# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.4] - 2026-01-10

### Fixed

- Fixed config file detection to only match files named exactly `.sops.yaml` or `.sops.yml`, not any file ending with those patterns
- Fixed encryption failing when using `.sops.yml` (instead of `.sops.yaml`) as config filename
  - Extension now explicitly passes config path to SOPS via `--config` flag
  - Works around SOPS CLI limitation that only accepts `.sops.yaml` when searching automatically
- Fixed temp file naming to preserve SOPS pattern matching (e.g., `file.sops.yml` → `file.sopsie-temp-123.sops.yml`)
  - Ensures `path_regex` rules in `.sops.yaml` continue to match temp files correctly

### Changed

- Updated error messages to reference both `.sops.yaml` and `.sops.yml` config file formats

## [0.1.3] - 2025-12-23

### Fixed

- Fixed encryption failing on Windows with "cannot operate on non-existent file c:\dev\stdin" error
- Fixed encryption failing in containerized/restricted environments with "open /dev/stdin: no such device or address" error
- Use temp file approach for content encryption instead of unreliable stdin piping

## [0.1.2] - 2025-11-27

### Added

- Add edit button to preview tabs for switching from read-only preview to editable mode
- New `switchToEditInPlace` command that transitions decrypted previews to editable temp files while preserving column layout
- Add `untrackDocument` method to EditorGroupTracker for proper mode switching

### Changed

- Replace manual path parsing with `path.basename()` for cleaner code
- Remove deprecated error handler functions (log, logError, dispose)

## [0.1.1] - 2025-11-27

### Fixed

- Fixed column layout preservation when switching between encrypted files in beside mode
- Fixed document watcher to skip already-tracked decrypted temp files, preventing unnecessary re-processing

## [0.1.0] - 2025-11-27

- Initial release
