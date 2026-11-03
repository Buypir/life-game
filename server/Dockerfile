# Сервер нагадувань «Гри про життя»
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/LifeGame.Push/LifeGame.Push.csproj src/LifeGame.Push/
RUN dotnet restore src/LifeGame.Push/LifeGame.Push.csproj
COPY src/ src/
RUN dotnet publish src/LifeGame.Push/LifeGame.Push.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
# підписки й VAPID-ключі; змонтуй сюди том, щоб вони пережили перезапуск
ENV Push__DataDirectory=/data \
    ASPNETCORE_HTTP_PORTS=8080
RUN mkdir -p /data && chown $APP_UID:$APP_UID /data
VOLUME /data
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "LifeGame.Push.dll"]
