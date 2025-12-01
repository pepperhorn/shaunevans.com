# Build stage
FROM node:20-alpine AS builder

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY . .

# Build the Astro site
RUN pnpm run build

# Production stage
FROM caddy:2.9.1-alpine

# Set the working directory
WORKDIR /usr/share/caddy

# Copy the built Astro site from builder stage
COPY --from=builder /app/dist .

# Copy the Caddyfile
COPY Caddyfile /etc/caddy/Caddyfile

# Ensure correct permissions (using root, which is the default user in this image)
RUN chown -R root:root /usr/share/caddy && \
	chmod -R 755 /usr/share/caddy

# Expose port 80
EXPOSE 80

# Start Caddy
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
