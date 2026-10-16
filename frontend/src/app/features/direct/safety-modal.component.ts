/**
 * src/app/features/direct/safety-modal.component.ts
 * Window to compare the safety number with a contact.
 */
import { copyText } from '../../shared/util/clipboard';
import {
  Component,
  computed,
  inject,
  input,
  output,
  resource,
  type ResourceLoaderParams,
} from '@angular/core';
import { AuthService } from '../../core/services/auth.service';
import { DirectoryService } from '../../core/services/directory.service';
import { fingerprint, formatFingerprint, safetyNumber } from '../../core/crypto/fingerprint';
import { ToastService } from '../../core/services/toast.service';
import type { User } from '../../core/models';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { IconComponent } from '../../shared/components/icon.component';
import { ModalComponent } from '../../shared/components/modal.component';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';

/** Lets two people compare a short number out-of-band to prove nobody swapped their keys. */
@Component({
  selector: 'app-safety-modal',
  standalone: true,
  imports: [ModalComponent, AvatarComponent, IconComponent, TranslatePipe],
  template: `
    <app-modal
      [title]="'Verify encryption' | t"
      [subtitle]="'Compare these numbers over a channel you trust (a call, in person).' | t"
      [width]="520"
      (closed)="closed.emit()"
    >
      <div class="flex items-center justify-center gap-4 py-2">
        <app-avatar [user]="auth.user()" [size]="48" />
        <app-icon name="shield-check" [size]="26" class="text-accent" />
        <app-avatar [user]="user()" [size]="48" />
      </div>

      <div class="mt-3 rounded-ui border border-accent/25 bg-accent/5 p-4">
        <div class="label mb-2 text-center text-accent">{{ 'Safety number' | t }}</div>
        <div
          class="grid grid-cols-4 gap-x-2 gap-y-2 text-center font-mono text-[0.8125rem] font-bold tracking-wide sm:gap-x-3 sm:text-[0.9375rem] sm:tracking-wider"
        >
          @for (g of groups(); track $index) {
            <span class="anim-fade-in" [style.--d]="$index * 40 + 'ms'">{{ g }}</span>
          }
        </div>
      </div>

      <p class="mt-3 text-xs text-muted">
        {{
          'A contact is verified once for your account: your other devices see it as verified too.'
            | t
        }}
      </p>

      <details class="mt-3 min-w-0 text-xs text-muted">
        <summary class="cursor-pointer font-semibold hover:text-fg">
          {{ 'Show raw identity fingerprints' | t }}
        </summary>
        <div class="mt-2 space-y-2 break-all font-mono text-xs font-bold tracking-wider">
          <div>
            <b class="text-fg">{{ 'You' | t }}</b
            ><br />{{ mine() }}
          </div>
          <div>
            <b class="text-fg">{{ user()?.displayName }}</b
            ><br />{{ theirs() }}
          </div>
        </div>
      </details>

      <div class="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        @if (directory.isVerified(userId())) {
          <span class="chip chip-accent self-start sm:self-auto"
            ><app-icon name="check" [size]="11" /> {{ 'Verified' | t }}</span
          >
        } @else {
          <span class="min-w-0 text-xs text-muted">{{
            'Numbers match? Mark them as verified.' | t
          }}</span>
        }
        <div class="flex flex-wrap gap-2 max-sm:[&>.btn]:flex-1">
          <button class="btn" type="button" (click)="copy()">
            <app-icon name="copy" [size]="15" /> {{ 'Copy' | t }}
          </button>
          @if (!directory.isVerified(userId())) {
            <button class="btn btn-primary" type="button" (click)="verify()">
              <app-icon name="shield-check" [size]="15" /> {{ 'Mark as verified' | t }}
            </button>
          }
        </div>
      </div>
    </app-modal>
  `,
})
export class SafetyModalComponent {
  readonly userId = input.required<string>();
  readonly closed = output<void>();
  protected readonly auth = inject(AuthService);
  protected readonly directory = inject(DirectoryService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  protected readonly user = computed<User | undefined>(
    function (this: SafetyModalComponent) {
      return this.directory.users().get(this.userId());
    }.bind(this),
  );
  private readonly number = resource({
    params: function (this: SafetyModalComponent) {
      return this.user();
    }.bind(this),
    loader: async function (
      this: SafetyModalComponent,
      { params }: ResourceLoaderParams<User | undefined>,
    ) {
      return safetyNumber(this.auth.identity.publicKeys, params.publicKeys);
    }.bind(this),
  });
  private readonly prints = resource({
    params: function (this: SafetyModalComponent) {
      return this.user();
    }.bind(this),
    loader: async function (
      this: SafetyModalComponent,
      { params }: ResourceLoaderParams<User | undefined>,
    ) {
      return {
        mine: formatFingerprint(await fingerprint(this.auth.identity.publicKeys)),
        theirs: formatFingerprint(await fingerprint(params.publicKeys)),
      };
    }.bind(this),
  });
  protected readonly groups = computed(
    function (this: SafetyModalComponent) {
      return (this.number.value() ?? '').split(' ').filter(Boolean);
    }.bind(this),
  );
  protected readonly mine = computed(
    function (this: SafetyModalComponent) {
      return this.prints.value()?.mine ?? '…';
    }.bind(this),
  );
  protected readonly theirs = computed(
    function (this: SafetyModalComponent) {
      return this.prints.value()?.theirs ?? '…';
    }.bind(this),
  );

  /** Copies the safety number. */
  protected async copy(): Promise<void> {
    if (await copyText(this.number.value() ?? ''))
      this.toast.success(this.i18n.t('Copied to clipboard'));
    else this.toast.error(this.i18n.t('Clipboard unavailable'));
  }

  /** Marks the contact as verified: from then on the person is warned if their keys ever change. */
  protected async verify(): Promise<void> {
    await this.directory.markVerified(this.userId());
    this.toast.success(
      this.i18n.t('Contact verified'),
      this.i18n.t('You will be warned if their keys ever change.'),
    );
  }
}
