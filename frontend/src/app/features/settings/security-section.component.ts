/**
 * src/app/features/settings/security-section.component.ts
 * Settings - Privacy & security: identity fingerprint, privacy options and password.
 */
import { linkCrypto, type TextPart } from '../../core/crypto-docs';
import { copyText } from '../../shared/util/clipboard';
import { Component, computed, inject, signal } from '@angular/core';
import { fingerprint, formatFingerprint } from '../../core/crypto/fingerprint';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { IconComponent } from '../../shared/components/icon.component';
import {
  SegmentedComponent,
  SettingRowComponent,
  ToggleComponent,
} from '../../shared/components/controls.component';
import { ApiService } from '../../core/services/api.service';
import type { User } from '../../core/models';
import { SettingsService } from '../../core/services/settings.service';
import { ModalComponent } from '../../shared/components/modal.component';
import { describeError, passwordScore } from '../../shared/util/errors';

@Component({
  selector: 'app-security-section',
  standalone: true,
  imports: [
    IconComponent,
    ModalComponent,
    SegmentedComponent,
    SettingRowComponent,
    ToggleComponent,
    TranslatePipe,
  ],
  styles: `
    /* the fingerprint is one line: the letters shrink with the box (about 74 characters), and on a narrow screen it breaks in two balanced lines */
    .fp-box {
      container-type: inline-size;
    }
    .fp-text {
      white-space: nowrap;
      font-size: min(0.8125rem, 1.85cqw);
    }
    @container (max-width: 34rem) {
      .fp-text {
        white-space: normal;
        text-wrap: balance;
        word-spacing: 0.25em;
        font-size: 0.8125rem;
      }
    }
  `,
  template: `
    <section class="rounded-ui-lg border border-white/8 bg-black/20 p-5">
      <h2 class="mb-1 flex items-center gap-2 text-sm font-semibold">
        <app-icon name="key" [size]="16" class="text-accent" />
        {{ 'Your cryptographic identity' | t }}
      </h2>
      <p class="mb-3 text-sm text-muted">
        {{
          'This fingerprint identifies your keys. Friends can compare it to be sure it is really you.'
            | t
        }}
      </p>
      <div class="fp-box flex items-center gap-2 rounded-ui bg-black/30 p-3 font-mono font-bold">
        <span class="fp-text selectable min-w-0 flex-1 text-accent">{{ fingerprintText() }}</span>
        <button
          class="btn btn-icon btn-sm tip"
          [attr.data-tip]="'Copy' | t"
          type="button"
          (click)="copy()"
        >
          <app-icon name="copy" [size]="14" />
        </button>
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        <button class="btn btn-sm" type="button" (click)="pwOpen.set(true)">
          <app-icon name="key" [size]="14" /> {{ 'Change password' | t }}
        </button>
      </div>
    </section>

    <section class="settings-card">
      <h2 class="settings-card-title">{{ 'Visibility' | t }}</h2>
      <app-setting-row
        title="Who can see you online"
        hint="Your online status. Anybody who is not allowed sees you as offline, whatever you do."
      >
        <app-segmented
          [options]="presenceOptions"
          [value]="presenceVisibility()"
          (valueChange)="choose({ presenceVisibility: $event })"
        />
      </app-setting-row>
      <app-setting-row
        title="Appear in search"
        hint="Other people can find you by typing your username. If you turn it off they need your exact username."
      >
        <app-toggle
          [checked]="searchable()"
          (checkedChange)="choose({ searchable: $event })"
          [label]="'Appear in search' | t"
        />
      </app-setting-row>
    </section>

    <section class="settings-card">
      <h2 class="pt-3 text-sm font-semibold">{{ 'Contact' | t }}</h2>
      <app-setting-row
        title="Who can send you friend requests"
        hint="Closed requests do not affect the friends you already have."
      >
        <app-segmented
          [options]="requestOptions"
          [value]="friendRequests()"
          (valueChange)="choose({ friendRequests: $event })"
        />
      </app-setting-row>
    </section>

    <section class="settings-card">
      <h2 class="pt-3 text-sm font-semibold">{{ 'Conversations' | t }}</h2>
      <app-setting-row
        title="Send read receipts"
        hint="Others see when you have read their messages. If you turn it off, nobody knows you read them and you do not see when they read yours. Unread counts keep working."
      >
        <app-toggle
          [checked]="settings.sendReadReceipts()"
          (checkedChange)="settings.sendReadReceipts.set($event)"
          [label]="'Send read receipts' | t"
        />
      </app-setting-row>
      <app-setting-row
        title="Show when you are typing"
        hint="Others see the three dots while you write. Turn it off to write without them knowing."
      >
        <app-toggle
          [checked]="settings.sendTyping()"
          (checkedChange)="settings.sendTyping.set($event)"
          [label]="'Show when you are typing' | t"
        />
      </app-setting-row>
      <app-setting-row
        title="Show message marks"
        hint="The sent, delivered and read marks under your messages."
      >
        <app-toggle
          [checked]="settings.showMessageStatus()"
          (checkedChange)="settings.showMessageStatus.set($event)"
          [label]="'Show message marks' | t"
        />
      </app-setting-row>
      <app-setting-row
        title="Show the fonts of other people"
        hint="Friends can give their name a font file of their own. It comes encrypted and the browser checks it before using it. Turn it off to see every name in the built-in fonts."
      >
        <app-toggle
          [checked]="settings.showSharedFonts()"
          (checkedChange)="settings.showSharedFonts.set($event)"
          [label]="'Show the fonts of other people' | t"
        />
      </app-setting-row>
    </section>
    <section class="mt-6">
      <h2 class="mb-3 text-sm font-semibold">{{ 'How your data is protected' | t }}</h2>
      <ul class="space-y-3">
        @for (item of items; track item.title) {
          <li class="flex gap-3 rounded-ui border border-white/6 bg-white/[.025] p-3.5">
            <span
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-ui bg-accent/12 text-accent"
              ><app-icon [name]="item.icon" [size]="18"
            /></span>
            <div>
              <div class="text-sm font-semibold">{{ item.title | t }}</div>
              <div class="text-xs leading-relaxed text-muted">
                @for (part of parts(item.text); track $index) {
                  @if (part.url) {
                    <a
                      class="crypto-inline"
                      [href]="part.url"
                      target="_blank"
                      rel="noopener noreferrer"
                      >{{ part.text }}</a
                    >
                  } @else {
                    {{ part.text }}
                  }
                }
              </div>
            </div>
          </li>
        }
      </ul>
    </section>

    @if (pwOpen()) {
      <app-modal
        [title]="'Change password' | t"
        [subtitle]="
          'Your private keys are re-encrypted with the new password. Other devices are signed out.'
            | t
        "
        (closed)="pwOpen.set(false)"
      >
        <form class="space-y-3" (submit)="changePassword($event)">
          <input
            class="input"
            type="password"
            [placeholder]="'Current password' | t"
            autocomplete="current-password"
            [value]="oldPw()"
            (input)="oldPw.set($any($event.target).value)"
          />
          <input
            class="input"
            type="password"
            [placeholder]="'New password (10+ characters)' | t"
            autocomplete="new-password"
            [value]="newPw()"
            (input)="newPw.set($any($event.target).value)"
          />
          <div class="flex gap-1.5">
            @for (i of [1, 2, 3, 4]; track i) {
              <div
                class="h-1.5 flex-1 rounded-full transition-colors"
                [style.background]="score() >= i ? 'var(--accent)' : 'rgba(255,255,255,.08)'"
              ></div>
            }
          </div>
          @if (pwError()) {
            <p class="text-sm text-red-300">{{ pwError() }}</p>
          }
          <div class="flex justify-end gap-2">
            <button class="btn" type="button" (click)="pwOpen.set(false)">{{ 'Cancel' | t }}</button
            ><button
              class="btn btn-primary"
              type="submit"
              [disabled]="!oldPw() || newPw().length < 10 || pwBusy()"
            >
              @if (pwBusy()) {
                {{ 'Re-encrypting keys…' | t }}
              } @else {
                {{ 'Update password' | t }}
              }
            </button>
          </div>
        </form>
      </app-modal>
    }
  `,
})
export class SecuritySectionComponent {
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  protected readonly settings = inject(SettingsService);

  private readonly api = inject(ApiService);

  protected readonly presenceOptions = [
    { id: 'everyone', label: 'All' },
    { id: 'friends', label: 'Friends' },
    { id: 'nobody', label: 'Nobody' },
  ];
  protected readonly requestOptions = [
    { id: 'everyone', label: 'All' },
    { id: 'nobody', label: 'Nobody' },
  ];
  protected readonly presenceVisibility = computed(
    function (this: SecuritySectionComponent) {
      return this.auth.user()?.privacy?.presenceVisibility ?? 'everyone';
    }.bind(this),
  );
  protected readonly friendRequests = computed(
    function (this: SecuritySectionComponent) {
      return this.auth.user()?.privacy?.friendRequests ?? 'everyone';
    }.bind(this),
  );
  protected readonly searchable = computed(
    function (this: SecuritySectionComponent) {
      return this.auth.user()?.privacy?.searchable ?? true;
    }.bind(this),
  );

  protected readonly fingerprintText = signal('…');
  protected readonly pwOpen = signal(false);
  protected readonly oldPw = signal('');
  protected readonly newPw = signal('');
  protected readonly pwError = signal('');
  protected readonly pwBusy = signal(false);
  protected readonly score = computed(
    function (this: SecuritySectionComponent) {
      return passwordScore(this.newPw());
    }.bind(this),
  );

  /** The text of a card, with the names of the encryption systems as links to their documents. */
  protected parts(text: string): TextPart[] {
    return linkCrypto(this.i18n.t(text));
  }

  protected readonly items = [
    {
      icon: 'lock',
      title: 'Messages',
      text: 'AES-256-GCM, signed with your key (ECDSA P-256). The server only stores ciphertext.',
    },
    {
      icon: 'phone',
      title: 'Calls',
      text: 'Audio and video frames are encrypted on your device with ephemeral keys that rotate every 30 seconds, on top of DTLS-SRTP (WebRTC Encoded Transform).',
    },
    {
      icon: 'file',
      title: 'Files, GIFs and stickers',
      text: 'Encrypted before upload with a one-time key and verified with SHA-256 after download.',
    },
    {
      icon: 'shield',
      title: 'Contacts',
      text: 'Shared secrets come from an ECDH P-256 exchange; contacts are verified with safety numbers (Trust on first use).',
    },
    {
      icon: 'key',
      title: 'Your password',
      text: 'Never sent to the server. PBKDF2 hardens it, HKDF derives your keys and scrypt protects its proof; it only unlocks your keys in this browser.',
    },
  ];

  constructor() {
    void fingerprint(this.auth.identity.publicKeys).then(
      function (this: SecuritySectionComponent, fp: string) {
        return this.fingerprintText.set(formatFingerprint(fp));
      }.bind(this),
    );
  }

  /** Saves a privacy choice on the server, which is the one that enforces it, and shows the answer. */
  protected async choose(patch: Record<string, unknown>): Promise<void> {
    try {
      const response = await this.api.patch<{ user: User }>('/api/me', patch);
      this.auth.setUser(response.user);
    } catch {
      this.toast.error(this.i18n.t('Could not save the change.'));
    }
  }

  /** Copies the fingerprint of the own keys. */
  protected async copy(): Promise<void> {
    if (await copyText(this.fingerprintText()))
      this.toast.success(this.i18n.t('Copied to clipboard'));
    else this.toast.error(this.i18n.t('Clipboard unavailable'));
  }

  /**
   * Changes the password: the private keys are re-encrypted in the browser with the new one before anything is sent.
   */
  protected async changePassword(event: Event): Promise<void> {
    event.preventDefault();
    this.pwBusy.set(true);
    this.pwError.set('');
    try {
      await this.auth.changePassword(this.auth.user()!.username, this.oldPw(), this.newPw());
      this.pwOpen.set(false);
      this.oldPw.set('');
      this.newPw.set('');
      this.toast.success(this.i18n.t('Password updated'));
    } catch (e) {
      this.pwError.set(describeError(e));
    } finally {
      this.pwBusy.set(false);
    }
  }
}
