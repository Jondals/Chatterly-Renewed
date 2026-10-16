/**
 * src/app/features/settings/sessions-card.component.ts
 * Settings - Privacy & security: the devices where the person is signed in (every one is a session). Each one says when it was
 * opened and when it ends, which is this device and which are connected now, and any of the others can be closed. Nothing
 * about the devices is known to the server (no address, no model, no place): it is only the day each session opened.
 */
import { ChangeDetectionStrategy, Component, inject, signal, type OnInit } from '@angular/core';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import { ApiService } from '../../core/services/api.service';
import { DialogService } from '../../core/services/dialog.service';
import { ToastService } from '../../core/services/toast.service';
import { IconComponent } from '../../shared/components/icon.component';

/** One session of the person. */
interface MySession {
  id: string;
  createdAt: number;
  expiresAt: number;
  current: boolean;
  online: boolean;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-sessions-card',
  standalone: true,
  imports: [IconComponent, TranslatePipe],
  template: `
    <section class="settings-card">
      <h2 class="settings-card-title">{{ 'Your sessions' | t }}</h2>
      <p class="pb-2 text-xs text-muted">
        {{
          'The devices where you are signed in. Close the ones you do not use or do not know: they have to sign in again.'
            | t
        }}
      </p>
      @for (item of list(); track item.id) {
        <div class="flex items-center gap-3 border-t border-white/6 py-2.5 first:border-t-0">
          <app-icon name="smartphone" [size]="16" class="shrink-0 text-muted" />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
              {{ 'Session' | t }} · {{ item.id.slice(0, 4) }}
              @if (item.current) {
                <span class="chip chip-accent">{{ 'This device' | t }}</span>
              } @else if (item.online) {
                <span class="chip">{{ 'Connected now' | t }}</span>
              }
            </div>
            <div class="text-xs text-dim">{{ dates(item) }}</div>
          </div>
          @if (!item.current) {
            <button
              type="button"
              class="btn btn-sm btn-soft-danger"
              [disabled]="busy()"
              (click)="close(item)"
            >
              {{ 'Close' | t }}
            </button>
          }
        </div>
      } @empty {
        <p class="py-2 text-xs text-muted">{{ 'Loading…' | t }}</p>
      }
      @if (list().length > 1) {
        <button
          type="button"
          class="btn btn-sm btn-soft-danger mt-3 gap-1.5"
          [disabled]="busy()"
          (click)="closeOthers()"
        >
          <app-icon name="logout" [size]="13" /> {{ 'Close all the other sessions' | t }}
        </button>
      }
    </section>
  `,
})
export class SessionsCardComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  protected readonly list = signal<MySession[]>([]);
  protected readonly busy = signal(false);

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.list.set((await this.api.get<{ sessions: MySession[] }>('/api/me/sessions')).sessions);
    } catch {
      // A server that is older than this app has no list: the card stays empty.
    }
  }

  protected dates(item: MySession): string {
    return this.i18n.t('Opened {date} · ends {end}', {
      date: new Date(item.createdAt).toLocaleDateString(),
      end: new Date(item.expiresAt).toLocaleDateString(),
    });
  }

  protected async close(item: MySession): Promise<void> {
    await this.run(this.api.post.bind(this.api, '/api/me/sessions/' + item.id + '/close'));
  }

  protected async closeOthers(): Promise<void> {
    const sure = await this.dialog.confirm(
      this.i18n.t('Close all the other sessions'),
      this.i18n.t('Every other device has to sign in again. This one stays open.'),
      { confirmLabel: this.i18n.t('Close'), danger: true },
    );
    if (sure) await this.run(this.api.post.bind(this.api, '/api/me/sessions/close-others'));
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      this.toast.success(this.i18n.t('Session closed'));
    } catch {
      this.toast.error(this.i18n.t('Could not do it'), this.i18n.t('Try again.'));
    } finally {
      this.busy.set(false);
    }
    await this.load();
  }
}
