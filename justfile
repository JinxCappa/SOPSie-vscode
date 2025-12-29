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

# Clean build artifacts
clean:
    rm -rf out dist *.vsix node_modules
