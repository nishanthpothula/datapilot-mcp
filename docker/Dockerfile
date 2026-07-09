# ─── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for layer caching
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy source and compile
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ─── Stage 2: Runner ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

# Security: run as non-root
RUN addgroup -S datapilot && adduser -S datapilot -G datapilot

WORKDIR /app

# Copy only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist
COPY docker/start.sh ./start.sh

# Create data directory with correct ownership
RUN mkdir -p /app/data && chown -R datapilot:datapilot /app/data && chmod +x /app/start.sh

USER datapilot

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Default command: seed DB then start server
CMD ["/app/start.sh"]
