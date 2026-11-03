using System.Diagnostics;
using System.Reflection;
using System.Runtime.CompilerServices;

namespace LifeGame.Push.Tests;

/// <summary>Позначає тест. Метод може бути void або async Task.</summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class TestAttribute : Attribute;

public sealed class AssertionException(string message) : Exception(message);

/// <summary>
/// Невеликий тест-ранер без зовнішніх пакетів: проєкт збирається навіть без доступу до NuGet.
/// Запуск: dotnet run --project tests/LifeGame.Push.Tests [фільтр]
/// </summary>
public static class TestRunner
{
    public static async Task<int> Main(string[] args)
    {
        var filter = args.FirstOrDefault();
        var tests = typeof(TestRunner).Assembly.GetTypes()
            .SelectMany(t => t.GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.Instance))
            .Where(m => m.GetCustomAttribute<TestAttribute>() is not null)
            .Where(m => filter is null || $"{m.DeclaringType!.Name}.{m.Name}".Contains(filter, StringComparison.OrdinalIgnoreCase))
            .OrderBy(m => m.DeclaringType!.Name).ThenBy(m => m.Name)
            .ToList();

        var failed = 0;
        var watch = Stopwatch.StartNew();
        foreach (var method in tests)
        {
            var name = $"{method.DeclaringType!.Name}.{method.Name}";
            try
            {
                var instance = method.IsStatic ? null : Activator.CreateInstance(method.DeclaringType!);
                var result = method.Invoke(instance, null);
                if (result is Task task) await task;
                if (instance is IDisposable disposable) disposable.Dispose();
                Console.WriteLine($"  ok    {name}");
            }
            catch (Exception ex)
            {
                failed++;
                var inner = ex is TargetInvocationException { InnerException: { } e } ? e : ex;
                Console.WriteLine($"  FAIL  {name}\n        {inner.GetType().Name}: {inner.Message}");
            }
        }

        Console.WriteLine($"\n{tests.Count - failed} passed, {failed} failed ({watch.ElapsedMilliseconds} ms)");
        return failed == 0 ? 0 : 1;
    }
}

public static class Check
{
    public static void Equal<T>(T expected, T actual, [CallerArgumentExpression(nameof(actual))] string? expr = null)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
            throw new AssertionException($"{expr}: expected <{expected}>, got <{actual}>");
    }

    public static void True(bool condition, [CallerArgumentExpression(nameof(condition))] string? expr = null)
    {
        if (!condition) throw new AssertionException($"expected true: {expr}");
    }

    public static void False(bool condition, [CallerArgumentExpression(nameof(condition))] string? expr = null)
    {
        if (condition) throw new AssertionException($"expected false: {expr}");
    }

    public static void Null(object? value, [CallerArgumentExpression(nameof(value))] string? expr = null)
    {
        if (value is not null) throw new AssertionException($"{expr}: expected null, got <{value}>");
    }

    public static void NotNull(object? value, [CallerArgumentExpression(nameof(value))] string? expr = null)
    {
        if (value is null) throw new AssertionException($"{expr}: expected a value, got null");
    }

    public static void Contains(string expected, string? actual, [CallerArgumentExpression(nameof(actual))] string? expr = null)
    {
        if (actual is null || !actual.Contains(expected, StringComparison.Ordinal))
            throw new AssertionException($"{expr}: expected to contain <{expected}>, got <{actual}>");
    }

    public static TException Throws<TException>(Action action) where TException : Exception
    {
        try
        {
            action();
        }
        catch (TException ex)
        {
            return ex;
        }
        throw new AssertionException($"expected {typeof(TException).Name}");
    }
}
