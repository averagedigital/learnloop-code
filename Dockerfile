FROM node:22-slim

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4173
ENV CODELEARN_ENV_PATH=/data/.env
ENV CODELEARN_DB_PATH=/data/codelearn.sqlite
ENV PERSONALITY_PATH=/data/personality.md

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.mjs server.mjs ./
COPY src ./src
COPY assets ./assets
RUN npm run build
RUN mkdir -p /data /app/workspace && chown -R node:node /data /app/workspace

EXPOSE 4173
VOLUME ["/data", "/app/workspace"]

USER node
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD node -e "fetch('http://127.0.0.1:4173/api/app-state').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
