.PHONY: setup run test docker-build docker-run

setup:
	bundle install

run:
	ruby app.rb

test:
	ruby -c app.rb

docker-build:
	docker build -t $$(basename $$(pwd)) .

docker-run:
	docker run --env-file .env -p 3000:3000 $$(basename $$(pwd))
