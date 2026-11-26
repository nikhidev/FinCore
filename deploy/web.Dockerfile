FROM node:22-bookworm-slim AS dependencies
WORKDIR /srv
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY app ./app
COPY next.config.mjs postcss.config.mjs tsconfig.json ./
ARG NEXT_PUBLIC_DEMO_MODE=false
ENV NEXT_PUBLIC_DEMO_MODE=$NEXT_PUBLIC_DEMO_MODE API_URL=http://api:4000
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /srv
ENV NODE_ENV=production
COPY --from=build --chown=node:node /srv/.next ./.next
COPY --from=dependencies --chown=node:node /srv/node_modules ./node_modules
COPY --chown=node:node next.config.mjs package.json ./
USER node
EXPOSE 3000
CMD ["node","node_modules/next/dist/bin/next","start","-H","0.0.0.0"]
