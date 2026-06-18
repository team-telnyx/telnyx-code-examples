.PHONY: setup run test docker-build docker-run

setup:
	pip install -r requirements.txt

run:
	python app.py

test:
	python -m py_compile app.py

docker-build:
	docker build -t ai-real-estate-showing-scheduler-python .

docker-run:
	docker run --env-file .env -p 5000:5000 ai-real-estate-showing-scheduler-python
