FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile 2>&1 | head -100; exit 0
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build 2>&1 | head -100; exit 0

FROM node:22-alpine AS runtime
RUN addgroup -g 10001 pagurus && adduser -u 10001 -G pagurus -s /bin/sh -D pagurus
WORKDIR /app
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --prod 2>&1 | head -100; exit 0
COPY --from=builder /app/dist ./dist
RUN mkdir -p /data /workspace && chown pagurus:pagurus /data /workspace
USER pagurus
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://localhost:8080/healthz || exit 1
CMD ["node", "dist/index.js"]
