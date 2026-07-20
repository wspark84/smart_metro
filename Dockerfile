FROM node:22-bookworm-slim

WORKDIR /app

# Copy only runtime files. User data and credentials must never be baked into an image.
COPY --chown=node:node package.json server.mjs index.html ./
COPY --chown=node:node src ./src

ENV NODE_ENV=production
ENV PORT=4173
ENV TZ=Asia/Seoul

RUN mkdir -p /app/data && chown node:node /app/data

USER node

EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:4173/api/healthz').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"

CMD ["node", "server.mjs"]
