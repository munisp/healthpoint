# syntax=docker/dockerfile:1

########################################
# Build stage: compile Caddy with plugins
########################################
FROM caddy:2-builder-alpine AS builder

RUN xcaddy build \
    --with github.com/mholt/caddy-l4 \
    --with github.com/corazawaf/coraza-caddy/v2 \
    --with github.com/caddy-dns/cloudflare

########################################
# Runtime stage
########################################
FROM caddy:2-alpine

# Copy the custom Caddy binary from builder
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Copy configuration files
COPY Caddyfile /etc/caddy/Caddyfile
COPY layer4.json /etc/caddy/layer4.json
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Validate the Caddyfile (JSON layer4 config is loaded at runtime via the
# admin API by entrypoint.sh — see that script for why /load is not used).
RUN caddy fmt --overwrite /etc/caddy/Caddyfile && \
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

EXPOSE 80 443 443/udp 2019

CMD ["/entrypoint.sh"]
