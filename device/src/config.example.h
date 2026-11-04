// Скопіюй у config.h і заповни. config.h у .gitignore — паролі не потраплять у репозиторій.
#pragma once

#define WIFI_SSID "MyWiFi"
#define WIFI_PASS "password"

// «Герой» → «Автоматизації iPhone» → «ESP32» → «Копіювати».
#define DEVICE_URL "https://your-server.example.com/api/device/KEY"

// Київ: EET/EEST з переходом на літній час.
#define TZ_POSIX "EET-2EEST,M3.5.0/3,M10.5.0/4"

// Піни (ESP32 DevKit). OLED: SDA 21, SCL 22.
#define PIN_DONE 32    // кнопка «Готово» (на GND, внутрішня підтяжка)
#define PIN_NEXT 33    // кнопка «Далі»: інший екран / вимкнути будильник
#define PIN_BUZZER 25  // пасивна пищалка
