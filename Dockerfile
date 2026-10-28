ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS packages
WORKDIR /source
RUN npm install --global pnpm@10.33.0
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter docture --filter @docture/cli -r build
RUN mkdir /artifacts && pnpm --dir packages/docture pack --out /artifacts/docture.tgz && pnpm --dir packages/cli pack --out /artifacts/cli.tgz

FROM ${NODE_IMAGE} AS runtime
ARG TARGETARCH
RUN test "${TARGETARCH}" = "amd64"
RUN apt-get update && apt-get install --yes --no-install-recommends fontconfig fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/docture
COPY --from=packages /artifacts /artifacts
RUN npm install --save-exact --omit=dev --omit=optional /artifacts/docture.tgz /artifacts/cli.tgz pdfjs-dist@6.2.108 @napi-rs/canvas@1.0.10 @napi-rs/canvas-linux-x64-gnu@1.0.10 zod@4.4.3 && npm cache clean --force && rm -rf /artifacts
RUN node --input-type=module -e 'import {readFileSync,writeFileSync} from "node:fs";const packages=Object.fromEntries(["docture","@docture/cli","pdfjs-dist","@napi-rs/canvas","@napi-rs/canvas-linux-x64-gnu","zod"].map(name=>[name,JSON.parse(readFileSync(`node_modules/${name}/package.json`,"utf8")).version]));writeFileSync("versions.json",JSON.stringify({node:process.versions.node,platform:process.platform,architecture:process.arch,packages},null,2)+"\n");'
RUN mkdir /work && chown node:node /work
WORKDIR /work
USER node
ENV NODE_ENV=production
LABEL org.opencontainers.image.source="https://github.com/YasielCabrera/docture"
LABEL io.docture.platform="linux/amd64"
EXPOSE 8787
ENTRYPOINT ["node", "/opt/docture/node_modules/@docture/cli/dist/bin.js"]
CMD ["--help"]
