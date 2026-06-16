FROM ruby:3.3-slim

WORKDIR /app

COPY Gemfile Gemfile.lock* ./
RUN bundle install

COPY . .

RUN useradd -r appuser && chown -R appuser /app
USER appuser

EXPOSE 3000

CMD ["ruby", "app.rb"]
