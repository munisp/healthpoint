# HealthPoint IDR — Caddy with Coraza WAF, rate-limit, Layer 4, and DNS modules
# Build: docker build -t healthpoint-caddy ./infra/caddy/
FROM caddy:2.9-builder AS builder

RUN xcaddy build \
    --with github.com/corazawaf/coraza-caddy/v2 \
    --with github.com/corazawaf/coraza-coreruleset \
    --with github.com/mholt/caddy-ratelimit \
    --with github.com/mholt/caddy-l4 \
    --with github.com/caddyserver/caddy/v2/modules/caddyhttp/reverseproxy

FROM caddy:2.9-alpine

# Copy custom-built Caddy binary with all modules
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Create directories for config, certs, and logs
RUN mkdir -p /etc/caddy/certs /var/log/caddy /data/caddy /config/caddy

# Copy Caddyfile and Layer 4 config
COPY Caddyfile /etc/caddy/Caddyfile
COPY layer4.json /etc/caddy/layer4.json

# Copy OWASP CRS rules (downloaded at build time)
RUN apk add --no-cache curl && \
    mkdir -p /etc/caddy/crs && \
    curl -sL https://github.com/corazawaf/coraza-coreruleset/releases/latest/download/coreruleset.tar.gz \
      | tar -xz -C /etc/caddy/crs --strip-components=1 && \
    apk del curl

EXPOSE 80 443 443/udp 2019 3001 6380 7234 9004 9093 9201

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:2019/config/ || exit 1

ENTRYPOINT ["/usr/bin/caddy"]
CMD ["run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
