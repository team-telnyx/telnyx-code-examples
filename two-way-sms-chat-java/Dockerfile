FROM maven:3.9-eclipse-temurin-17 AS builder

WORKDIR /app

COPY pom.xml .
RUN mvn dependency:resolve

COPY . .
RUN mvn compile

FROM eclipse-temurin:17-jre-jammy
WORKDIR /app
COPY --from=builder /app .

RUN useradd -r appuser && chown -R appuser /app
USER appuser

EXPOSE 8080

CMD ["mvn", "exec:java"]
