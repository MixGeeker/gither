FROM node:24.22.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run check && npm run server:check && npm run selfhost:build && npm prune --omit=dev

FROM node:24.22.1-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 GITHER_DATA_DIR=/data
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.server-dist ./.server-dist
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node docker/entrypoint.sh /usr/local/bin/gither-entrypoint
RUN mkdir -p /data && chown node:node /data && chmod 700 /data && chmod 755 /usr/local/bin/gither-entrypoint
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "require('node:http').get({host:'127.0.0.1',port:3000,path:'/healthz',headers:{host:new URL(process.env.APP_ORIGIN).host}},r=>{r.resume();if(r.statusCode!==200)process.exit(1)}).on('error',()=>process.exit(1))"

ENTRYPOINT ["gither-entrypoint"]
CMD ["serve"]
