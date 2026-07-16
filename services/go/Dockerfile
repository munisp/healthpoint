FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o go-services .

FROM gcr.io/distroless/static-debian12
WORKDIR /app
COPY --from=builder /app/go-services .
EXPOSE 8001
ENTRYPOINT ["/app/go-services"]
