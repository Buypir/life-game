import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { QUESTS } from '../game/quests';
import { AppConfigService } from '../reminders/app-config.service';
import { NativeBridgeService } from '../native/native-bridge.service';
import { RemindersService, ReminderStatus } from '../reminders/reminders.service';

const STATUS_TEXT: Record<ReminderStatus, string> = {
  'needs-install':
    'На iPhone сповіщення працюють лише в грі, встановленій на головний екран: Safari → «Поділитися» → «На початковий екран».',
  unsupported:
    'Цей браузер або режим не підтримує пуш-сповіщення. Вони працюють у зібраній версії гри (GitHub Pages).',
  'no-server':
    'Сервер нагадувань не налаштовано. Розгорни його (див. README) і вкажи адресу нижче.',
  denied: 'Сповіщення заборонені. Дозволь їх у Параметрах iPhone → Сповіщення → Гра про життя.',
  off: 'Нагадування вимкнені.',
  on: 'Нагадування увімкнені. Про виконані квести сервер не нагадує.',
};

@Component({
  selector: 'app-reminders',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reminders.component.html',
})
export class RemindersComponent {
  protected readonly reminders = inject(RemindersService);
  protected readonly config = inject(AppConfigService);
  protected readonly nativeBridge = inject(NativeBridgeService);
  protected readonly alarmMessage = signal<string | null>(null);

  protected async toggleAlarm(): Promise<void> {
    const current = this.nativeBridge.alarm();
    this.alarmMessage.set(
      await this.nativeBridge.setAlarm({ ...current, enabled: !current.enabled }),
    );
  }

  protected async setAlarmTime(event: Event): Promise<void> {
    const time = (event.target as HTMLInputElement).value;
    if (!/^\d{2}:\d{2}$/.test(time)) return;
    const current = this.nativeBridge.alarm();
    this.alarmMessage.set(await this.nativeBridge.setAlarm({ ...current, time }));
  }

  protected readonly message = signal<{ text: string; error: boolean } | null>(null);
  protected readonly serverDraft = signal(this.config.apiUrl());
  protected readonly copied = signal(false);

  protected readonly statusText = computed(() => STATUS_TEXT[this.reminders.status()]);
  protected readonly canEnable = computed(() => this.reminders.status() === 'off');

  protected readonly rows = computed(() =>
    this.reminders.settings().map((s) => ({
      ...s,
      title: QUESTS.find((q) => q.id === s.questId)?.title ?? s.questId,
    })),
  );

  /** Адреса, яку відкриває автоматизація «Команд» після будильника. */
  protected readonly alarmUrl = (() => {
    const url = new URL('./?quest=morning', document.baseURI);
    return url.href;
  })();

  protected async enable(): Promise<void> {
    this.message.set(null);
    const error = await this.reminders.enable();
    this.message.set(
      error
        ? { text: error, error: true }
        : { text: 'Готово! Нагадування прийдуть за розкладом.', error: false },
    );
  }

  protected async disable(): Promise<void> {
    await this.reminders.disable();
    this.message.set({ text: 'Нагадування вимкнено.', error: false });
  }

  protected async test(): Promise<void> {
    this.message.set(null);
    const error = await this.reminders.sendTest();
    this.message.set(
      error
        ? { text: error, error: true }
        : { text: 'Тестове сповіщення надіслано.', error: false },
    );
  }

  protected onTime(questId: string, event: Event): void {
    this.reminders.setTime(questId, (event.target as HTMLInputElement).value);
  }

  protected onServerInput(event: Event): void {
    this.serverDraft.set((event.target as HTMLInputElement).value);
  }

  protected saveServer(): void {
    const ok = this.config.setApiUrl(this.serverDraft());
    this.serverDraft.set(this.config.apiUrl());
    this.message.set(
      ok
        ? { text: 'Адресу сервера збережено.', error: false }
        : { text: 'Потрібна адреса https://…', error: true },
    );
  }

  protected async copyAlarmUrl(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.alarmUrl);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      this.copied.set(false);
    }
  }
}
