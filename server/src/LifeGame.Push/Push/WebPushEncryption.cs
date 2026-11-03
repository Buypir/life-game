using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace LifeGame.Push.Push;

/// <summary>
/// Шифрування вмісту push-повідомлення за RFC 8291 (Message Encryption for Web Push)
/// у форматі aes128gcm (RFC 8188). Одна «запис» розміром до 4096 байт.
/// </summary>
public static class WebPushEncryption
{
    public const int RecordSize = 4096;

    private static readonly byte[] WebPushInfo = Encoding.ASCII.GetBytes("WebPush: info\0");
    private static readonly byte[] CekInfo = Encoding.ASCII.GetBytes("Content-Encoding: aes128gcm\0");
    private static readonly byte[] NonceInfo = Encoding.ASCII.GetBytes("Content-Encoding: nonce\0");

    /// <summary>Максимальна довжина відкритого тексту для однієї записи.</summary>
    public const int MaxPayloadLength = RecordSize - 16 /* tag */ - 1 /* delimiter */;

    /// <param name="payload">Відкритий текст (UTF-8 JSON).</param>
    /// <param name="userAgentPublicKey">p256dh з підписки браузера: 65 байт.</param>
    /// <param name="authSecret">auth з підписки браузера: 16 байт.</param>
    public static byte[] Encrypt(ReadOnlySpan<byte> payload, ReadOnlySpan<byte> userAgentPublicKey, ReadOnlySpan<byte> authSecret)
    {
        Span<byte> salt = stackalloc byte[16];
        RandomNumberGenerator.Fill(salt);
        using var serverKey = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        return Encrypt(payload, userAgentPublicKey, authSecret, serverKey, salt);
    }

    /// <summary>Детермінований варіант (свій ключ і сіль) — для тестів.</summary>
    public static byte[] Encrypt(
        ReadOnlySpan<byte> payload,
        ReadOnlySpan<byte> userAgentPublicKey,
        ReadOnlySpan<byte> authSecret,
        ECDiffieHellman serverKey,
        ReadOnlySpan<byte> salt)
    {
        if (payload.Length > MaxPayloadLength)
            throw new ArgumentException($"Payload is too large ({payload.Length} > {MaxPayloadLength} bytes).");
        if (authSecret.Length != 16)
            throw new ArgumentException("Auth secret must be 16 bytes.");
        if (salt.Length != 16)
            throw new ArgumentException("Salt must be 16 bytes.");

        var serverPublic = EcPoint.ToUncompressed(serverKey.ExportParameters(false).Q);
        using var userAgentKey = ECDiffieHellman.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            Q = EcPoint.FromUncompressed(userAgentPublicKey),
        });
        var ecdhSecret = serverKey.DeriveRawSecretAgreement(userAgentKey.PublicKey);

        // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
        var keyInfo = Concat(WebPushInfo, userAgentPublicKey, serverPublic);
        var prkKey = HKDF.Extract(HashAlgorithmName.SHA256, ecdhSecret, authSecret.ToArray());
        var ikm = HKDF.Expand(HashAlgorithmName.SHA256, prkKey, 32, keyInfo);

        var prk = HKDF.Extract(HashAlgorithmName.SHA256, ikm, salt.ToArray());
        var cek = HKDF.Expand(HashAlgorithmName.SHA256, prk, 16, CekInfo);
        var nonce = HKDF.Expand(HashAlgorithmName.SHA256, prk, 12, NonceInfo);

        // остання (єдина) запис: дані || 0x02, без додаткового паддінгу
        var plaintext = new byte[payload.Length + 1];
        payload.CopyTo(plaintext);
        plaintext[^1] = 0x02;

        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[16];
        using (var aes = new AesGcm(cek, tagSizeInBytes: 16))
        {
            aes.Encrypt(nonce, plaintext, ciphertext, tag);
        }

        // заголовок: salt(16) || rs(4, big-endian) || idlen(1) || keyid(65 = публічний ключ сервера)
        var body = new byte[16 + 4 + 1 + serverPublic.Length + ciphertext.Length + tag.Length];
        var span = body.AsSpan();
        salt.CopyTo(span);
        BinaryPrimitives.WriteUInt32BigEndian(span[16..], RecordSize);
        span[20] = (byte)serverPublic.Length;
        serverPublic.CopyTo(span[21..]);
        ciphertext.CopyTo(span[(21 + serverPublic.Length)..]);
        tag.CopyTo(span[(21 + serverPublic.Length + ciphertext.Length)..]);
        return body;
    }

    private static byte[] Concat(byte[] a, ReadOnlySpan<byte> b, byte[] c)
    {
        var result = new byte[a.Length + b.Length + c.Length];
        a.CopyTo(result, 0);
        b.CopyTo(result.AsSpan(a.Length));
        c.CopyTo(result, a.Length + b.Length);
        return result;
    }
}
