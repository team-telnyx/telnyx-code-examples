// Program.cs
using DotNetEnv;
using TelnyxCallTransfer.Services;

var builder = WebApplication.CreateBuilder(args);

// Load environment variables from .env file
Env.Load();

// Add services to the container
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Register HttpClient for Telnyx API calls
builder.Services.AddHttpClient("Telnyx", client =>
{
    client.DefaultRequestHeaders.Authorization =
        new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Bearer", Environment.GetEnvironmentVariable("TELNYX_API_KEY"));
    client.BaseAddress = new Uri("https://api.telnyx.com/v2");
});

// Register CallService
builder.Services.AddScoped<CallService>();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

app.Run();
