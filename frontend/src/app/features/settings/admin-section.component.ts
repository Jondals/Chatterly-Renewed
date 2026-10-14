/**
 * src/app/features/settings/admin-section.component.ts
 * Settings - Administration (administrators only): who can try the beta versions of the desktop app.
 * The list lives on the server; the server refuses these calls to anybody who is not an administrator.
 */
import { Component, inject, signal } from '@angular/core';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import { BetaService, type BetaTester } from '../../core/services/beta.service';
import { ToastService } from '../../core/services/toast.service';
import { describeError } from '../../shared/util/errors';
import { IconComponent } from '../../shared/components/icon.component';

/** Settings > Administration: the beta testers. */
@Component({
  selector: 'app-admin-section',
  standalone: true,
  imports: [IconComponent, TranslatePipe],
  template: `
    <section class="settings-card">
      <h2 class="settings-card-title">{{ 'Beta testers' | t }}</h2>
      <p class="mb-4 text-sm text-muted">
        {{
          'People who receive the beta versions of the desktop app before everybody else, and tell you what breaks. They choose in Settings > Updates whether to use them.'
            | t
        }}
      </p>
      <form class="flex flex-wrap gap-2" (submit)="add($event)">
        <input
          class="input min-w-0 flex-1"
          type="text"
          maxlength="24"
          autocomplete="off"
          [placeholder]="'Username' | t"
          [value]="name()"
          (input)="name.set($any($event.target).value)"
        />
        <button type="submit" class="btn btn-primary" [disabled]="busy() || !name().trim()">
          <app-icon name="user-plus" [size]="16" /> {{ 'Add tester' | t }}
        </button>
      </form>
    </section>

    <section class="settings-card mt-4">
      @for (tester of beta.testers(); track tester.id) {
        <div class="flex items-center gap-3 py-2">
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-semibold">{{ tester.displayName }}</div>
            <div class="truncate text-xs text-muted">
              &#64;{{ tester.username }} · {{ since(tester) }}
            </div>
          </div>
          <button
            type="button"
            class="btn btn-icon btn-sm btn-ghost"
            [attr.aria-label]="'Remove' | t"
            (click)="remove(tester)"
          >
            <app-icon name="x" [size]="16" />
          </button>
        </div>
      } @empty {
        <p class="text-sm text-muted">{{ 'Nobody is a beta tester yet.' | t }}</p>
      }
    </section>
    <section class="settings-card mt-6">
      <h2 class="settings-card-title">{{ 'Administrators' | t }}</h2>
      <p class="mb-4 text-sm text-muted">
        {{
          'People who can manage this page: add testers and other administrators. The ones marked as owner are set in the server and cannot be removed here.'
            | t
        }}
      </p>
      <form class="flex flex-wrap gap-2" (submit)="addAdmin($event)">
        <input
          class="input min-w-0 flex-1"
          type="text"
          maxlength="24"
          autocomplete="off"
          [placeholder]="'Username' | t"
          [value]="adminName()"
          (input)="adminName.set($any($event.target).value)"
        />
        <button type="submit" class="btn btn-primary" [disabled]="busy() || !adminName().trim()">
          <app-icon name="user-plus" [size]="16" /> {{ 'Add administrator' | t }}
        </button>
      </form>
      @for (admin of beta.admins(); track admin.id) {
        <div class="mt-3 flex items-center gap-3">
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-semibold">{{ admin.displayName }}</div>
            <div class="truncate text-xs text-muted">
              &#64;{{ admin.username }}
              @if (admin.fixed) {
                · {{ 'Owner' | t }}
              }
            </div>
          </div>
          @if (!admin.fixed) {
            <button
              type="button"
              class="btn btn-icon btn-sm btn-ghost"
              [attr.aria-label]="'Remove' | t"
              (click)="removeAdmin(admin.id)"
            >
              <app-icon name="x" [size]="16" />
            </button>
          }
        </div>
      }
    </section>
  `,
})
export class AdminSectionComponent {
  protected readonly beta = inject(BetaService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  protected readonly name = signal('');
  protected readonly adminName = signal('');
  protected readonly busy = signal(false);

  /** "Added 3/4/2026". */
  protected since(tester: BetaTester): string {
    return this.i18n.t('Added {date}', { date: new Date(tester.addedAt).toLocaleDateString() });
  }

  /** Makes the person a tester. */
  protected async add(event: Event): Promise<void> {
    event.preventDefault();
    const username = this.name().trim().replace(/^@/, '');
    if (!username) return;
    this.busy.set(true);
    try {
      await this.beta.add(username);
      this.name.set('');
    } catch (e) {
      this.toast.error(this.i18n.t('Could not add the tester'), this.i18n.t(describeError(e)));
    } finally {
      this.busy.set(false);
    }
  }

  /** Makes the person an administrator. */
  protected async addAdmin(event: Event): Promise<void> {
    event.preventDefault();
    const username = this.adminName().trim().replace(/^@/, '');
    if (!username) return;
    this.busy.set(true);
    try {
      await this.beta.addAdmin(username);
      this.adminName.set('');
    } catch (e) {
      this.toast.error(
        this.i18n.t('Could not add the administrator'),
        this.i18n.t(describeError(e)),
      );
    } finally {
      this.busy.set(false);
    }
  }

  /** Takes the administration away from the person. */
  protected async removeAdmin(id: string): Promise<void> {
    try {
      await this.beta.removeAdmin(id);
    } catch (e) {
      this.toast.error(this.i18n.t('Could not remove it'), this.i18n.t(describeError(e)));
    }
  }

  /** Takes the person out of the program. */
  protected async remove(tester: BetaTester): Promise<void> {
    try {
      await this.beta.remove(tester.id);
    } catch (e) {
      this.toast.error(this.i18n.t('Could not remove it'), this.i18n.t(describeError(e)));
    }
  }
}
