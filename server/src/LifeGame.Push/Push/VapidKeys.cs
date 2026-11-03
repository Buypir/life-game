using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace LifeGame.Push.Push;

/// <summary>
/// VAPID-ключі (RFC 8292): P-256 пара, якою сервер підписує JWT для push-сервісів.
/// Публічний ключ — 65 байт (0x04 || X || Y), приватний — 32 байти D, обидва в base64url.
/// </summary>
public sealed class VapidKeys
{
    public string PublicKey { get; }

    public string PrivateKey { get; }

    private readonly byte[] _publicBytes;
    private readonly byte[] _privateBytes;

    public VapidKeys(string publicKey, string privateKey)
    {
        _publicBytes = Base64Url.DecodeFromChars(publicKey);
        _privateBytes = Base64Url.DecodeFromChars(privateKey);
        if (_publicBytes.Length != 65 || _publicBytes[0] != 0x04)
            throw new ArgumentException("VAPID public key must be an uncompressed P-256 point (65 bytes).");
        if (_privateBytes.Length != 32)
            throw new ArgumentException("VAPID private key must be 32 bytes.");
        PublicKey = publicKey;
        PrivateKey = privateKey;
    }

    public static VapidKeys Generate()
    {
        using var ecdsa = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var p = ecdsa.ExportParameters(includePrivateParameters: true);
        var publicBytes = EcPoint.ToUncompressed(p.Q);
        return new VapidKeys(Base64Url.EncodeToString(publicBytes), Base64Url.EncodeToString(p.D!));
    }

    /// <summary>Бере ключі з налаштувань, інакше з vapid.json у теці даних, інакше генерує й зберігає.</summary>
    public static VapidKeys Resolve(PushOptions options, ILogger logger)
    {
        if (!string.IsNullOrWhiteSpace(options.VapidPublicKey) && !string.IsNullOrWhiteSpace(options.VapidPrivateKey))
            return new VapidKeys(options.VapidPublicKey.Trim(), options.VapidPrivateKey.Trim());

        Directory.CreateDirectory(options.DataDirectory);
        var path = Path.Combine(options.DataDirectory, "vapid.json");
        if (File.Exists(path))
        {
            var stored = JsonSerializer.Deserialize<StoredKeys>(File.ReadAllText(path))
                ?? throw new InvalidOperationException($"Cannot read {path}");
            return new VapidKeys(stored.PublicKey, stored.PrivateKey);
        }

        var keys = Generate();
        File.WriteAllText(path, JsonSerializer.Serialize(new StoredKeys(keys.PublicKey, keys.PrivateKey)));
        logger.LogWarning(
            "Generated new VAPID keys in {Path}. Keep this file: if it is lost, every device must subscribe again.",
            path);
        return keys;
    }

    /// <summary>Підписаний JWT (ES256) для заголовка Authorization: vapid t=…, k=… .</summary>
    public string CreateJwt(string audience, string subject, DateTimeOffset expires)
    {
        var header = Base64Url.EncodeToString("""{"typ":"JWT","alg":"ES256"}"""u8);
        var claims = JsonSerializer.SerializeToUtf8Bytes(new Dictionary<string, object>
        {
            ["aud"] = audience,
            ["exp"] = expires.ToUnixTimeSeconds(),
            ["sub"] = subject,
        });
        var signingInput = $"{header}.{Base64Url.EncodeToString(claims)}";

        using var ecdsa = ECDsa.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            D = _privateBytes,
            Q = EcPoint.FromUncompressed(_publicBytes),
        });
        var signature = ecdsa.SignData(
            Encoding.ASCII.GetBytes(signingInput),
            HashAlgorithmName.SHA256,
            DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        return $"{signingInput}.{Base64Url.EncodeToString(signature)}";
    }

    private sealed record StoredKeys(string PublicKey, string PrivateKey);
}

internal static class EcPoint
{
    public static byte[] ToUncompressed(ECPoint q)
    {
        var result = new byte[65];
        result[0] = 0x04;
        q.X!.CopyTo(result, 1);
        q.Y!.CopyTo(result, 33);
        return result;
    }

    public static ECPoint FromUncompressed(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length != 65 || bytes[0] != 0x04)
            throw new ArgumentException("Expected an uncompressed P-256 point (65 bytes).");
        return new ECPoint { X = bytes[1..33].ToArray(), Y = bytes[33..].ToArray() };
    }
}
