FROM golang:1.22 AS builder

WORKDIR /app

COPY go.mod go.sum* ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/server .

FROM alpine:3.19
WORKDIR /app
COPY --from=builder /app/server .

RUN adduser -D appuser
USER appuser

EXPOSE 8080

CMD ["./server"]
