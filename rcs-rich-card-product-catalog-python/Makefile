.PHONY: setup run test docker-build docker-run

setup:
	pip install -r requirements.txt

run:
	python app.py

test:
	python -m py_compile app.py

docker-build:
	docker build -t rcs-rich-card-product-catalog-python .

docker-run:
	docker run --env-file .env -p 5000:5000 rcs-rich-card-product-catalog-python
