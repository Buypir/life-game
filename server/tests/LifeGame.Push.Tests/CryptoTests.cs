using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using LifeGame.Push.Push;

namespace LifeGame.Push.Tests;

public static class CryptoTests
{
    [Test]
    public static void EncryptedPayloadDecryptsInTheBrowser()
    {
        using var browser = new FakeBrowser();
        var payload = Encoding.UTF8.GetBytes("""{"notification":{"title":"Привіт"}}""");
        var body = WebPushEncryption.Encrypt(payload, browser.PublicKey, browser.AuthSecret);
        Check.Equal(Encoding.UTF8.GetString(payload), Encoding.UTF8.GetString(browser.Decrypt(body)));
        // заголовок 86 байт + дані + роздільник + тег
        Check.Equal(86 + payload.Length + 1 + 16, body.Length);
    }

    [Test]
    public static void EachMessageUsesFreshSaltAndKey()
    {
        using var browser = new FakeBrowser();
        var a = WebPushEncryption.Encrypt("hi"u8, browser.PublicKey, browser.AuthSecret);
        var b = WebPushEncryption.Encrypt("hi"u8, browser.PublicKey, browser.AuthSecret);
        Check.False(a.AsSpan(0, 86).SequenceEqual(b.AsSpan(0, 86)));
    }

    [Test]
    public static void RejectsOversizedPayload()
    {
        using var browser = new FakeBrowser();
        Check.Throws<ArgumentException>(() =>
            WebPushEncryption.Encrypt(new byte[WebPushEncryption.MaxPayloadLength + 1], browser.PublicKey, browser.AuthSecret));
    }

    [Test]
    public static void GeneratedVapidKeysHaveTheRightShape()
    {
        var keys = VapidKeys.Generate();
        Check.Equal(65, Base64Url.DecodeFromChars(keys.PublicKey).Length);
        Check.Equal(32, Base64Url.DecodeFromChars(keys.PrivateKey).Length);
        Check.False(keys.PublicKey.Contains('=') || keys.PublicKey.Contains('+') || keys.PublicKey.Contains('/'));
    }

    [Test]
    public static void VapidJwtIsSignedWithTheVapidKey()
    {
        var keys = VapidKeys.Generate();
        var expires = new DateTimeOffset(2026, 11, 4, 12, 0, 0, TimeSpan.Zero);
        var jwt = keys.CreateJwt("https://web.push.apple.com", "mailto:me@example.com", expires);
        var parts = jwt.Split('.');
        Check.Equal(3, parts.Length);

        var header = JsonDocument.Parse(Base64Url.DecodeFromChars(parts[0])).RootElement;
        Check.Equal("ES256", header.GetProperty("alg").GetString());
        var claims = JsonDocument.Parse(Base64Url.DecodeFromChars(parts[1])).RootElement;
        Check.Equal("https://web.push.apple.com", claims.GetProperty("aud").GetString());
        Check.Equal("mailto:me@example.com", claims.GetProperty("sub").GetString());
        Check.Equal(expires.ToUnixTimeSeconds(), claims.GetProperty("exp").GetInt64());

        using var verifier = ECDsa.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            Q = EcPoint.FromUncompressed(Base64Url.DecodeFromChars(keys.PublicKey)),
        });
        var signature = Base64Url.DecodeFromChars(parts[2]);
        Check.Equal(64, signature.Length);
        Check.True(verifier.VerifyData(
            Encoding.ASCII.GetBytes($"{parts[0]}.{parts[1]}"), signature, HashAlgorithmName.SHA256,
            DSASignatureFormat.IeeeP1363FixedFieldConcatenation));
    }

    [Test]
    public static void RejectsMalformedVapidKeys()
    {
        Check.Throws<ArgumentException>(() => new VapidKeys(Base64Url.EncodeToString(new byte[33]), Base64Url.EncodeToString(new byte[32])));
    }
}
