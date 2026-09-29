FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/schema/package.json packages/schema/
COPY packages/domain/package.json packages/domain/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @ailab/api...
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @ailab/api... build && pnpm --filter @ailab/api deploy --prod --legacy /out

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
COPY --from=build /out/drizzle ./drizzle
USER node
EXPOSE 3001
CMD ["node", "dist/index.js"]
