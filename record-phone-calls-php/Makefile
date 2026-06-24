.PHONY: setup run test docker-build docker-run

setup:
	composer install

run:
	php index.php

test:
	php -l index.php

docker-build:
	docker build -t $$(basename $$(pwd)) .

docker-run:
	docker run --env-file .env -p 8000:8000 $$(basename $$(pwd))
