using System.Threading.RateLimiting;
using LifeGame.Push;
using LifeGame.Push.Api;
using LifeGame.Push.Push;
using LifeGame.Push.Scheduling;
using LifeGame.Push.Storage;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<PushOptions>(builder.Configuration.GetSection(PushOptions.Section));
var pushOptions = builder.Configuration.GetSection(PushOptions.Section).Get<PushOptions>() ?? new PushOptions();

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton(sp => VapidKeys.Resolve(
    sp.GetRequiredService<IOptions<PushOptions>>().Value,
    sp.GetRequiredService<ILoggerFactory>().CreateLogger("Vapid")));
builder.Services.AddSingleton<SubscriptionStore>();
builder.Services.AddHttpClient<IPushSender, WebPushSender>(client => client.Timeout = TimeSpan.FromSeconds(15));
builder.Services.AddSingleton<ReminderWorker>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<ReminderWorker>());

builder.Services.AddProblemDetails();
builder.Services.AddCors(cors => cors.AddDefaultPolicy(policy => policy
    .WithOrigins(pushOptions.AllowedOrigins)
    .WithHeaders("Content-Type", PushApi.SecretHeader, PushApi.AccessKeyHeader)
    .WithMethods("GET", "POST", "PUT", "DELETE")));
builder.Services.AddRateLimiter(limiter =>
{
    limiter.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    limiter.AddPolicy("api", http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 120, Window = TimeSpan.FromMinutes(1) }));
});
builder.Services.Configure<ForwardedHeadersOptions>(forwarded =>
{
    // хостинги (Render, Fly, Azure) ставлять сервер за проксі
    forwarded.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    forwarded.KnownIPNetworks.Clear();
    forwarded.KnownProxies.Clear();
});

var app = builder.Build();

// ключі створюються на старті, щоб помилку конфігурації було видно одразу
var vapid = app.Services.GetRequiredService<VapidKeys>();
app.Logger.LogInformation("VAPID public key: {Key}", vapid.PublicKey);

app.UseForwardedHeaders();
app.UseExceptionHandler();
app.UseCors();
app.UseRateLimiter();

app.MapGet("/", () => Results.Text("Life Game push server is running. See /health."));
app.MapGet("/health", (SubscriptionStore store) => Results.Ok(new { status = "ok", subscriptions = store.All().Count }));
app.MapPushApi();
app.MapGameApi();

app.Run();

public partial class Program;
