FROM node:22-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies (including devDeps needed for build)
COPY package*.json ./
RUN npm install --production=false

# Copy source and build
COPY . .
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# Persistent data volume
RUN mkdir -p /data

ENV NODE_ENV=production

CMD ["node", "dist/src/index.js"]
