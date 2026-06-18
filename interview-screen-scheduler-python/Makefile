include .env
export

.PHONY: run install clean

install:
	pip install -r requirements.txt

run:
	python app.py

clean:
	find . -type d -name __pycache__ -exec rm -rf {} +
