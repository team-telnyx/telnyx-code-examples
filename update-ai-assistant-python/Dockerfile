FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN useradd -r appuser && chown -R appuser /app
USER appuser

EXPOSE 8000

CMD ["python", "app.py"]
