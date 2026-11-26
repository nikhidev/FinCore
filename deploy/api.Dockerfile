FROM node:22-bookworm-slim
WORKDIR /srv
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node api ./api
ENV NODE_ENV=production API_HOST=0.0.0.0
USER node
EXPOSE 4000
CMD ["node","api/server.mjs"]
