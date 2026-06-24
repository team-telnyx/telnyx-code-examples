FROM mcr.microsoft.com/dotnet/sdk:8.0 AS builder

WORKDIR /app

COPY *.csproj .
RUN dotnet restore

COPY . .
RUN dotnet publish -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=builder /app/publish .

RUN useradd -r appuser && chown -R appuser /app
USER appuser

EXPOSE 5000

CMD ["dotnet", "TelnyxExample.dll"]
