FROM ruby:3.3-slim

WORKDIR /app

COPY Gemfile Gemfile.lock* ./
RUN bundle install

COPY . .

RUN useradd -r appuser && chown -R appuser /app
USER appuser

EXPOSE 4567

CMD ["ruby", "app.rb"]
