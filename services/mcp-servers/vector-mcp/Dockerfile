FROM node:25-alpine AS builder

WORKDIR /app

COPY package.json ./
COPY tsconfig.json ./
COPY shared ./shared
COPY vector-mcp ./vector-mcp

RUN npm install
RUN npm run build -w shared && npm run build:vector

FROM node:25-alpine

WORKDIR /app

COPY --from=builder /app/vector-mcp/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/vector-mcp/package.json ./package.json

COPY --from=builder /app/shared/package.json ./node_modules/@cuemarshal/mcp-shared/package.json
COPY --from=builder /app/shared/dist ./node_modules/@cuemarshal/mcp-shared/dist

ENV MCP_TRANSPORT=http
ENV PORT=80

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/health || exit 1

CMD ["node", "dist/index.js"]
