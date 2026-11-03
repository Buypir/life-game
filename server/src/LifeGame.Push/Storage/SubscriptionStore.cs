using System.Text.Json;
using Microsoft.Extensions.Options;

namespace LifeGame.Push.Storage;

/// <summary>
/// Підписки в пам'яті + subscriptions.json на диску. Для особистого сервера на кілька пристроїв
/// цього досить; запис атомарний (тимчасовий файл + перейменування).
/// </summary>
public sealed class SubscriptionStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    private readonly string _path;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private readonly ILogger<SubscriptionStore> _logger;
    private Dictionary<string, SubscriptionRecord> _items;

    public SubscriptionStore(IOptions<PushOptions> options, ILogger<SubscriptionStore> logger)
    {
        _logger = logger;
        Directory.CreateDirectory(options.Value.DataDirectory);
        _path = Path.Combine(options.Value.DataDirectory, "subscriptions.json");
        _items = Load();
    }

    public IReadOnlyList<SubscriptionRecord> All()
    {
        lock (_items) return _items.Values.ToList();
    }

    public SubscriptionRecord? Get(string id)
    {
        lock (_items) return _items.GetValueOrDefault(id);
    }

    public SubscriptionRecord? FindByEndpoint(string endpoint)
    {
        lock (_items) return _items.Values.FirstOrDefault(s => s.Endpoint == endpoint);
    }

    public Task UpsertAsync(SubscriptionRecord record, CancellationToken ct = default) =>
        MutateAsync(items => items[record.Id] = record, ct);

    public async Task<bool> RemoveAsync(string id, CancellationToken ct = default)
    {
        var removed = false;
        await MutateAsync(items => removed = items.Remove(id), ct);
        return removed;
    }

    /// <summary>Атомарно змінює одну підписку. Повертає оновлений запис або null, якщо його немає.</summary>
    public async Task<SubscriptionRecord?> UpdateAsync(
        string id, Func<SubscriptionRecord, SubscriptionRecord> change, CancellationToken ct = default)
    {
        SubscriptionRecord? updated = null;
        await MutateAsync(items =>
        {
            if (items.TryGetValue(id, out var current))
            {
                updated = change(current);
                items[id] = updated;
            }
        }, ct);
        return updated;
    }

    private async Task MutateAsync(Action<Dictionary<string, SubscriptionRecord>> change, CancellationToken ct)
    {
        await _lock.WaitAsync(ct);
        try
        {
            Dictionary<string, SubscriptionRecord> snapshot;
            lock (_items)
            {
                var next = new Dictionary<string, SubscriptionRecord>(_items);
                change(next);
                _items = next;
                snapshot = next;
            }
            var temp = _path + ".tmp";
            await File.WriteAllTextAsync(temp, JsonSerializer.Serialize(snapshot.Values, Json), ct);
            File.Move(temp, _path, overwrite: true);
        }
        finally
        {
            _lock.Release();
        }
    }

    private Dictionary<string, SubscriptionRecord> Load()
    {
        if (!File.Exists(_path)) return [];
        try
        {
            var list = JsonSerializer.Deserialize<List<SubscriptionRecord>>(File.ReadAllText(_path), Json) ?? [];
            return list.ToDictionary(s => s.Id);
        }
        catch (JsonException ex)
        {
            var backup = _path + $".broken-{DateTime.UtcNow:yyyyMMddHHmmss}";
            File.Copy(_path, backup, overwrite: true);
            _logger.LogError(ex, "Cannot read {Path}; starting empty, the old file is kept as {Backup}", _path, backup);
            return [];
        }
    }
}
