import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { GameStateService } from '../game/game-state.service';
import { MAX_FREEZES, Reward, SHOP, ShopItem, XP_PER_COIN } from '../game/shop';
import { HeroSpriteComponent } from '../scene/hero-sprite.component';
import { ItemIconComponent } from '../scene/item-icon.component';

type ShopTab = 'shirt' | 'accessory' | 'room' | 'bonus' | 'rewards';

const TABS: { id: ShopTab; label: string }[] = [
  { id: 'shirt', label: 'Одяг' },
  { id: 'accessory', label: 'Аксесуари' },
  { id: 'room', label: 'Кімната' },
  { id: 'bonus', label: 'Бонуси' },
  { id: 'rewards', label: 'Нагороди' },
];

@Component({
  selector: 'app-shop',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HeroSpriteComponent, ItemIconComponent],
  templateUrl: './shop.component.html',
})
export class ShopComponent {
  protected readonly game = inject(GameStateService);
  protected readonly tabs = TABS;
  protected readonly tab = signal<ShopTab>('shirt');
  protected readonly xpPerCoin = XP_PER_COIN;
  protected readonly maxFreezes = MAX_FREEZES;
  /** Перше натискання «Купити» лише питає підтвердження. */
  protected readonly pending = signal<string | null>(null);
  protected readonly message = signal<{ text: string; error: boolean } | null>(null);
  protected readonly rewardTitle = signal('');
  protected readonly rewardPrice = signal(500);
  private pendingTimer?: ReturnType<typeof setTimeout>;

  protected readonly items = computed(() => {
    const tab = this.tab();
    return SHOP.filter((i) =>
      tab === 'accessory' ? i.category === 'hat' || i.category === 'face' : i.category === tab,
    );
  });

  protected readonly history = computed(() => [...this.game.redeemed()].reverse().slice(0, 5));

  protected selectTab(tab: ShopTab): void {
    this.tab.set(tab);
    this.pending.set(null);
    this.message.set(null);
  }

  protected state(item: ShopItem): 'equipped' | 'owned' | 'buy' {
    const e = this.game.equipped();
    if (e.shirt === item.id || e.hat === item.id || e.face === item.id) return 'equipped';
    if (item.price === 0 || this.game.owned().has(item.id)) return 'owned';
    return 'buy';
  }

  protected affordable(price: number): boolean {
    return this.game.coins() >= price;
  }

  protected act(item: ShopItem): void {
    const state = item.category === 'bonus' ? 'buy' : this.state(item);
    if (state !== 'buy') {
      if (item.category !== 'room') this.game.toggleEquip(item.id);
      return;
    }
    if (this.pending() !== item.id) {
      this.ask(item.id);
      return;
    }
    this.pending.set(null);
    const error = this.game.buy(item.id);
    this.message.set(
      error ? { text: error, error: true } : { text: `Куплено: ${item.title}`, error: false },
    );
  }

  protected redeem(reward: Reward): void {
    if (this.pending() !== reward.id) {
      this.ask(reward.id);
      return;
    }
    this.pending.set(null);
    const error = this.game.redeem(reward.id);
    this.message.set(
      error
        ? { text: error, error: true }
        : { text: `«${reward.title}» — заслужено! Насолоджуйся.`, error: false },
    );
  }

  protected addReward(): void {
    if (this.game.addReward(this.rewardTitle(), Number(this.rewardPrice()))) {
      this.rewardTitle.set('');
      this.message.set(null);
    } else {
      this.message.set({ text: 'Вкажи назву й ціну від 1 монети.', error: true });
    }
  }

  protected removeReward(reward: Reward): void {
    this.game.removeReward(reward.id);
  }

  protected dateLabel(iso: string): string {
    return new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
  }

  private ask(id: string): void {
    this.pending.set(id);
    this.message.set(null);
    clearTimeout(this.pendingTimer);
    this.pendingTimer = setTimeout(() => this.pending.set(null), 4000);
  }
}
