.PHONY: setup run test docker-build docker-run

setup:
	dotnet restore

run:
	dotnet run

test:
	dotnet build

docker-build:
	docker build -t $$(basename $$(pwd)) .

docker-run:
	docker run --env-file .env -p 5000:5000 $$(basename $$(pwd))
