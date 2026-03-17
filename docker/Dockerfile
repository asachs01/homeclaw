# Stage 1: builder
FROM node:22-slim AS builder

ARG NODE_AUTH_TOKEN

WORKDIR /app

# Configure npm to pull @asachs01 packages from GitHub Packages
RUN echo "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}" > .npmrc && \
    echo "@asachs01:registry=https://npm.pkg.github.com" >> .npmrc

# Install all dependencies (including devDeps needed for TypeScript build)
COPY package*.json ./
RUN npm install --production=false

# Copy source and compile
COPY . .
RUN npm run build

# Drop dev dependencies
RUN npm prune --production

# Remove the auth token from the image filesystem
RUN rm -f .npmrc

# Stage 2: runtime
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only what's needed to run
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

RUN mkdir -p /data

ENV NODE_ENV=production

CMD ["node", "dist/src/index.js"]
