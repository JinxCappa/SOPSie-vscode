FROM node:22-alpine AS build

ARG MODE=release

WORKDIR /ext

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json esbuild.js eslint.config.mjs ./
COPY src/ src/

RUN if [ "$MODE" = "dev" ]; then \
      node -e "const p=require('./package.json'); p.version+='-dev'; require('fs').writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"; \
      npm run compile; \
    else \
      npm run package; \
    fi

RUN npx @vscode/vsce package --no-dependencies -o /ext/sopsie.vsix

FROM scratch AS artifact
COPY --from=build /ext/sopsie.vsix /sopsie.vsix
