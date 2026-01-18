FROM node:25-alpine AS builder

WORKDIR /app

COPY package.json ./
COPY tsconfig.json ./
COPY shared ./shared
COPY conductor-mcp ./conductor-mcp

RUN npm install
RUN npm run build -w shared && npm run build:conductor

FROM node:25-alpine

WORKDIR /app

COPY --from=builder /app/conductor-mcp/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/conductor-mcp/package.json ./package.json

# Set up shared package in node_modules so @cuemarshal/mcp-shared/transport resolves
COPY --from=builder /app/shared/package.json ./node_modules/@cuemarshal/mcp-shared/package.json
COPY --from=builder /app/shared/dist ./node_modules/@cuemarshal/mcp-shared/dist

ENV MCP_TRANSPORT=http
ENV PORT=80

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/health || exit 1

CMD ["node", "dist/index.js"]
