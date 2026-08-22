# syntax=docker/dockerfile:1

# Shared build image for every frontend workspace in this monorepo.
# Select the target with the WORKSPACE / APP_DIR build args.

FROM node:22-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# Dependency layer: only manifests, so it is reused until the lockfile changes.
FROM base AS deps
COPY package.json yarn.lock .yarnrc.yml ./
COPY apps/console-front/package.json apps/console-front/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/map-webgpu-canvas/package.json apps/map-webgpu-canvas/package.json
COPY apps/platform-client/package.json apps/platform-client/package.json
RUN yarn install --immutable

FROM deps AS build
ARG WORKSPACE
ARG VITE_MAP_URL
ARG VITE_MOBILE_URL
ARG VITE_PLATFORM_REGION_CODE
ARG VITE_TMAP_ENABLED
ARG VITE_TMAP_TILE_URL
ENV VITE_MAP_URL=${VITE_MAP_URL}
ENV VITE_MOBILE_URL=${VITE_MOBILE_URL}
ENV VITE_PLATFORM_REGION_CODE=${VITE_PLATFORM_REGION_CODE}
ENV VITE_TMAP_ENABLED=${VITE_TMAP_ENABLED}
ENV VITE_TMAP_TILE_URL=${VITE_TMAP_TILE_URL}
COPY . .
RUN yarn workspace ${WORKSPACE} build

FROM nginx:alpine AS runtime
ARG APP_DIR
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/${APP_DIR}/dist /usr/share/nginx/html
EXPOSE 80
