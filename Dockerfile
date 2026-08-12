FROM node:22-slim

WORKDIR /app
COPY . .

RUN npm install -g corepack@latest \
    && corepack pnpm install \
    && corepack pnpm run build

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
