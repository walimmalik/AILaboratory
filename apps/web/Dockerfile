FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/schema/package.json packages/schema/
COPY packages/client/package.json packages/client/
COPY packages/domain/package.json packages/domain/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @ailab/web...
COPY packages packages
COPY apps/web apps/web
# The in-app Wiki page bundles the project wiki at build time.
COPY docs/wiki docs/wiki
RUN pnpm --filter @ailab/web build

FROM nginx:1.29-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
