FROM php:8.3-cli

WORKDIR /app

RUN apt-get update && apt-get install -y unzip libsodium-dev \
    && docker-php-ext-install sodium \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

COPY composer.json .
RUN composer install --no-dev --optimize-autoloader

COPY . .

RUN useradd -r appuser && chown -R appuser /app
USER appuser

EXPOSE 8000

CMD ["php", "index.php"]
