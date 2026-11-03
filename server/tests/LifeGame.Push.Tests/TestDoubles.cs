using System.Buffers.Text;
using System.Security.Cryptography;
using LifeGame.Push.Push;
using LifeGame.Push.Storage;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace LifeGame.Push.Tests;

public sealed class ManualTime(DateTimeOffset start) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = start;

    public override DateTimeOffset GetUtcNow() => Now;

    public void Advance(TimeSpan by) => Now += by;
}

public sealed class FakeSender : IPushSender
{
    public List<(string SubscriptionId, string Payload, string? Topic)> Sent { get; } = [];

    public Queue<PushOutcome> Outcomes { get; } = new();

    public Task<PushResult> SendAsync(SubscriptionRecord subscription, byte[] payload, string? topic, CancellationToken ct)
    {
        var outcome = Outcomes.Count > 0 ? Outcomes.Dequeue() : PushOutcome.Delivered;
        if (outcome == PushOutcome.Delivered)
            Sent.Add((subscription.Id, System.Text.Encoding.UTF8.GetString(payload), topic));
        return Task.FromResult(new PushResult(outcome));
    }
}

/// <summary>Тимчасова тека з даними, яка видаляється після тесту.</summary>
public sealed class TempData : IDisposable
{
    public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "lifegame-tests-" + Guid.NewGuid().ToString("N"));

    public IOptions<PushOptions> Options(Action<PushOptions>? configure = null)
    {
        var options = new PushOptions { DataDirectory = Path };
        configure?.Invoke(options);
        return Microsoft.Extensions.Options.Options.Create(options);
    }

    public SubscriptionStore Store(IOptions<PushOptions>? options = null) =>
        new(options ?? Options(), NullLogger<SubscriptionStore>.Instance);

    public void Dispose()
    {
        if (Directory.Exists(Path)) Directory.Delete(Path, recursive: true);
    }
}

/// <summary>Імітує браузер: ключі підписки й розшифрування push-повідомлення (RFC 8291).</summary>
public sealed class FakeBrowser : IDisposable
{
    public ECDiffieHellman Key { get; } = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);

    public byte[] AuthSecret { get; } = RandomNumberGenerator.GetBytes(16);

    public byte[] PublicKey => EcPoint.ToUncompressed(Key.ExportParameters(false).Q);

    public string P256dh => Base64Url.EncodeToString(PublicKey);

    public string Auth => Base64Url.EncodeToString(AuthSecret);

    public byte[] Decrypt(byte[] body)
    {
        var salt = body[..16];
        var recordSize = (body[16] << 24) | (body[17] << 16) | (body[18] << 8) | body[19];
        Check.Equal(WebPushEncryption.RecordSize, recordSize);
        var idLength = body[20];
        var serverPublic = body[21..(21 + idLength)];
        var ciphertext = body[(21 + idLength)..^16];
        var tag = body[^16..];

        using var serverKey = ECDiffieHellman.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            Q = EcPoint.FromUncompressed(serverPublic),
        });
        var secret = Key.DeriveRawSecretAgreement(serverKey.PublicKey);
        var info = "WebPush: info\0"u8.ToArray().Concat(PublicKey).Concat(serverPublic).ToArray();
        var ikm = HKDF.Expand(HashAlgorithmName.SHA256, HKDF.Extract(HashAlgorithmName.SHA256, secret, AuthSecret), 32, info);
        var prk = HKDF.Extract(HashAlgorithmName.SHA256, ikm, salt);
        var cek = HKDF.Expand(HashAlgorithmName.SHA256, prk, 16, "Content-Encoding: aes128gcm\0"u8.ToArray());
        var nonce = HKDF.Expand(HashAlgorithmName.SHA256, prk, 12, "Content-Encoding: nonce\0"u8.ToArray());

        var plain = new byte[ciphertext.Length];
        using var aes = new AesGcm(cek, 16);
        aes.Decrypt(nonce, ciphertext, tag, plain);
        Check.Equal((byte)0x02, plain[^1]);
        return plain[..^1];
    }

    public void Dispose() => Key.Dispose();
}
