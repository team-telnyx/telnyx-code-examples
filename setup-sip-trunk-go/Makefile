.PHONY: setup run test docker-build docker-run

setup:
	go mod download

run:
	go run .

test:
	go vet .

docker-build:
	docker build -t $$(basename $$(pwd)) .

docker-run:
	docker run --env-file .env -p 8080:8080 $$(basename $$(pwd))
