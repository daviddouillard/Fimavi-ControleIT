# Image Cloud Run. Aucun secret dans l'image : les variables NUXT_* sont injectées depuis Secret Manager.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npx nuxt prepare && npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build --chown=node:node /app/.output ./.output
USER node
EXPOSE 8080
CMD ["node", ".output/server/index.mjs"]
