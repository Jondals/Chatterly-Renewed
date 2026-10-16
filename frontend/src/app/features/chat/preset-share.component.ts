/**
 * src/app/features/chat/preset-share.component.ts
 * The window of the "+" menu of the chat to send a preset (the look of the app or a profile) to the conversation: the presets
 * of the person, with their pictures, and a press sends one. Whoever gets it has a button to import it.
 */
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import type { Preset, PresetKind } from '../../core/preset';
import { PresetService } from '../../core/services/preset.service';
import { ToastService } from '../../core/services/toast.service';
import { ModalComponent } from '../../shared/components/modal.component';
import { describeError } from '../../shared/util/errors';
import { PresetThumbComponent } from '../settings/preset-thumb.component';

/** Chooses a preset and sends it to a conversation. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-preset-share',
  standalone: true,
  imports: [ModalComponent, PresetThumbComponent, TranslatePipe],
  template: `
    <app-modal
      [title]="'Share a preset' | t"
      [subtitle]="'It is sent to this chat; whoever gets it imports it with one button.' | t"
      [width]="480"
      (closed)="closed.emit()"
    >
      <div
        class="mb-4 grid grid-cols-2 rounded-ui border border-white/8 bg-black/25 p-1"
        role="tablist"
      >
        @for (tab of tabs; track tab.id) {
          <button
            type="button"
            role="tab"
            class="h-9 rounded-[calc(var(--r)*.75)] text-sm font-semibold transition-colors"
            [class]="kind() === tab.id ? 'bg-accent/20 text-accent' : 'text-muted hover:text-fg'"
            (click)="kind.set(tab.id)"
          >
            {{ tab.label | t }}
          </button>
        }
      </div>
      @if (list().length === 0) {
        <p class="rounded-ui border border-dashed border-white/10 p-5 text-center text-xs text-dim">
          {{ 'You have no presets of this kind yet. Make one in the settings.' | t }}
        </p>
      } @else {
        <div class="max-h-[22rem] space-y-2 overflow-y-auto pr-1">
          @for (p of list(); track p.id) {
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded-ui border border-white/8 bg-white/[.03] p-2.5 text-left transition-colors hover:border-accent/50 hover:bg-white/[.06]"
              [disabled]="busy()"
              (click)="send(p)"
            >
              <app-preset-thumb [preset]="p" />
              <span class="min-w-0 flex-1 truncate text-sm font-semibold">{{ p.name }}</span>
              <span class="btn btn-sm btn-primary pointer-events-none">{{ 'Send' | t }}</span>
            </button>
          }
        </div>
      }
    </app-modal>
  `,
})
export class PresetShareComponent {
  /** The conversation the preset goes to. */
  readonly channelId = input.required<string>();
  /** The window was closed (or a preset was sent). */
  readonly closed = output<void>();

  private readonly presets = inject(PresetService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  protected readonly tabs: { id: PresetKind; label: string }[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'theme', label: 'Theme of the app' },
  ];
  protected readonly kind = signal<PresetKind>('profile');
  protected readonly busy = signal(false);
  protected readonly list = computed(this.listOfKind.bind(this));

  constructor() {
    void this.presets.load();
  }

  /** The presets of the tab that is open. */
  private listOfKind(): Preset[] {
    const kind = this.kind();
    return this.presets.presets().filter(function same(preset) {
      return preset.kind === kind;
    });
  }

  /** Sends a preset to the conversation. */
  protected async send(preset: Preset): Promise<void> {
    this.busy.set(true);
    try {
      const left = await this.presets.share(preset, this.channelId());
      this.toast.success(
        this.i18n.t('Sent to the chat'),
        left.length ? this.i18n.t('Some big pieces did not fit and were left out.') : undefined,
      );
      this.closed.emit();
    } catch (e) {
      this.toast.error(this.i18n.t('Message not sent'), describeError(e));
    } finally {
      this.busy.set(false);
    }
  }
}
