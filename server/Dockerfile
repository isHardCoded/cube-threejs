FROM golang:1.26-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /server .

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
COPY --from=build /server /server
EXPOSE 8090
ENTRYPOINT ["/server"]
