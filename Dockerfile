FROM node:22-slim AS build

WORKDIR /app

RUN npm install -g pnpm@10.34.5

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build && pnpm prune --prod

FROM node:22-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN groupadd --system healthpoint && useradd --system --gid healthpoint --home-dir /app --shell /usr/sbin/nologin healthpoint

COPY --from=build --chown=healthpoint:healthpoint /app/package.json ./package.json
COPY --from=build --chown=healthpoint:healthpoint /app/node_modules ./node_modules
COPY --from=build --chown=healthpoint:healthpoint /app/dist ./dist

USER healthpoint
EXPOSE 3000
CMD ["node", "dist/index.js"]
