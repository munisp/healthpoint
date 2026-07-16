FROM rust:1.79-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev cmake build-essential && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock* ./
# Pre-build deps for layer caching
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src
COPY src ./src
RUN touch src/main.rs && cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/idr-rust-services .
EXPOSE 8002
ENTRYPOINT ["/app/idr-rust-services"]
