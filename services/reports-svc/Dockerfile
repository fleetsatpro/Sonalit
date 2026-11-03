FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build
FROM node:22-alpine AS runtime
RUN addgroup -S sonalit && adduser -S sonalit -G sonalit
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
USER sonalit
EXPOSE 4009
CMD ["node", "dist/index.js"]
