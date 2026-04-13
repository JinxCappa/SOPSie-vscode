default:
    @just --list

# Install dependencies
install:
    npm ci

# Dev build (sourcemaps, no minification, version tagged -dev)
dev: install
    node -e "const p=require('./package.json'); p.version+='-dev'; require('fs').writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
    npm run compile
    git checkout package.json

# Release build (minified, no sourcemaps)
release: install
    npm run package && npx @vscode/vsce package --no-dependencies

# Lint source code
lint: install
    npm run lint

# Type-check source code
check: install
    npm run check-types

# Watch for changes
watch: install
    npm run watch

# Run tests
test: install
    npm test

# Dev build via Docker
docker-dev:
    docker build --target artifact --build-arg MODE=dev --output type=local,dest=. .

# Release build via Docker
docker-release:
    docker build --target artifact --build-arg MODE=release --output type=local,dest=. .

# Create a release: bump version, update changelog, commit, tag, and push
publish version:
    #!/usr/bin/env bash
    set -euo pipefail
    VERSION="{{version}}"
    VERSION="${VERSION#v}"
    echo "Preparing release v${VERSION}..."
    npm version "${VERSION}" --no-git-tag-version
    git-cliff --config keepachangelog --tag "v${VERSION}" --output CHANGELOG.md --ignore-tags ".*-.*"
    git add package.json package-lock.json CHANGELOG.md
    git commit -m "chore: prepare for v${VERSION}"
    git tag -s "v${VERSION}" -m "v${VERSION}"
    git push origin main
    git push origin "v${VERSION}"
    echo "Released v${VERSION} — workflow will build and publish."

# Clean build artifacts
clean:
    rm -rf out dist *.vsix node_modules
