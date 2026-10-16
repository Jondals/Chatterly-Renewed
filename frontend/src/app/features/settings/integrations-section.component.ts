/**
 * src/app/features/settings/integrations-section.component.ts
 * Settings - Integrations: how Chatterly works with other apps. For now it is Spinly, the prize wheel app: wheels
 * and tournaments work without it, and linking the Spinly account brings its themes and presets into them.
 * The card follows the colors of the app (the accent), so it looks like part of it.
 */
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { SpinlyService } from '../../core/services/spinly.service';
import { SpinlyLogoComponent } from '../../shared/components/spinly-logo.component';
import { IconComponent } from '../../shared/components/icon.component';

/** The Spinly card of the integrations page. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-integrations-section',
  standalone: true,
  imports: [SpinlyLogoComponent, IconComponent, TranslatePipe],
  template: `
    <section class="overflow-hidden rounded-ui-lg border border-white/8 bg-black/20">
      <div
        class="flex flex-wrap items-center gap-4 border-b border-white/8 p-5"
        style="background: radial-gradient(ellipse at 0% 0%, color-mix(in oklab, var(--accent) 16%, transparent), transparent 65%)"
      >
        <span class="logo-glow shrink-0">
          <app-spinly-logo [size]="48" />
        </span>
        <div class="min-w-0 flex-1">
          <h2 class="text-base font-bold">Spinly</h2>
          <p class="text-sm text-muted">{{ 'Wheels and tournaments for chats and calls.' | t }}</p>
        </div>
        @if (spinly.profile()) {
          <span class="chip chip-accent"
            ><span class="h-1.5 w-1.5 rounded-full bg-current"></span> {{ 'Linked' | t }}</span
          >
        } @else {
          <span class="chip">{{ 'Not linked' | t }}</span>
        }
      </div>

      <div class="space-y-5 p-5">
        @if (spinly.profile(); as profile) {
          <div class="grid grid-cols-2 gap-3">
            <span class="stat">
              <b>{{ profile.themes.length }}</b> {{ 'themes' | t }}
            </span>
            <span class="stat">
              <b>{{ profile.presets.length }}</b> {{ 'presets' | t }}
            </span>
          </div>
          <div class="flex flex-wrap items-center gap-3 border-t border-white/8 pt-4">
            <p class="flex min-w-[14rem] flex-1 items-center gap-1.5 text-[0.6875rem] text-dim">
              <app-icon name="lock" [size]="11" class="shrink-0" />
              {{ 'Only names and colors are copied, never your login.' | t }}
            </p>
            <button type="button" class="btn btn-sm" (click)="link()">
              <app-icon name="refresh" [size]="13" /> {{ 'Update' | t }}
            </button>
            <button type="button" class="btn btn-sm btn-ghost" (click)="spinly.unlinkAccount()">
              {{ 'Unlink' | t }}
            </button>
          </div>
        } @else {
          <div class="flex flex-wrap items-center gap-4">
            <p class="min-w-[14rem] flex-1 text-sm text-muted">
              {{ 'Link your account to use your themes and presets.' | t }}
            </p>
            <button type="button" class="btn btn-primary" (click)="link()">
              <app-icon name="link" [size]="15" /> {{ 'Link my Spinly account' | t }}
            </button>
          </div>
          <p class="flex items-center gap-1.5 text-[0.6875rem] text-dim">
            <app-icon name="lock" [size]="11" class="shrink-0" />
            {{ 'Only names and colors are copied, never your login.' | t }}
          </p>
        }
      </div>

      <div class="grid gap-px border-t border-white/8 bg-white/6 sm:grid-cols-2">
        <div class="flex gap-3 bg-ink-850 p-4">
          <span class="menu-icon bg-accent/15 text-accent !h-9 !w-9 shrink-0"
            ><app-icon name="send" [size]="16"
          /></span>
          <div>
            <b class="text-sm">{{ 'In a chat' | t }}</b>
            <p class="text-xs leading-relaxed text-muted">
              {{ 'Sent like a poll: one spin for everybody.' | t }}
            </p>
          </div>
        </div>
        <div class="flex gap-3 bg-ink-850 p-4">
          <span class="menu-icon bg-sky/15 text-sky !h-9 !w-9 shrink-0"
            ><app-icon name="phone" [size]="16"
          /></span>
          <div>
            <b class="text-sm">{{ 'In a call' | t }}</b>
            <p class="text-xs leading-relaxed text-muted">
              {{ 'Everybody can spin it, edit it and play.' | t }}
            </p>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: `
    .logo-glow {
      border-radius: calc(var(--r) * 0.7);
      box-shadow:
        0 0 0 1px color-mix(in oklab, var(--accent) 35%, transparent),
        0 8px 28px -8px var(--accent);
    }
    .stat {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      padding: 0.7rem 1rem;
      border-radius: var(--r);
      border: 1px solid color-mix(in oklab, var(--accent) 30%, transparent);
      background: linear-gradient(
        135deg,
        color-mix(in oklab, var(--accent) 14%, transparent),
        color-mix(in oklab, var(--accent) 4%, transparent)
      );
      font-size: 0.85rem;
      color: var(--muted);
    }
    .stat b {
      font-size: 1.6rem;
      line-height: 1;
      color: var(--accent);
    }
    .preset-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.3rem 0.65rem;
      border-radius: calc(var(--r) * 0.5);
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.03);
      font-size: 0.75rem;
      font-weight: 600;
      transition:
        border-color 0.3s var(--ease-suave),
        background-color 0.3s var(--ease-suave);
    }
    .preset-chip:hover {
      border-color: color-mix(in oklab, var(--accent) 50%, transparent);
      background: color-mix(in oklab, var(--accent) 8%, transparent);
    }
    .preset-chip b {
      color: var(--accent);
      font-size: 0.7rem;
    }
  `,
})
export class IntegrationsSectionComponent {
  protected readonly spinly = inject(SpinlyService);

  /** Opens Spinly in the panel so the person can hand over their themes and presets. */
  protected link(): void {
    this.spinly.linkAccount();
  }
}
