/**
 * src/app/features/auth/register.component.ts
 * Registration form: generates the keys in the browser and measures the strength of the password.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import { warmApp } from '../../core/warm-app';
import { AuthService } from '../../core/services/auth.service';
import { IconComponent } from '../../shared/components/icon.component';
import { describeError, passwordScore } from '../../shared/util/errors';
import { ArrivalService } from '../../core/services/arrival.service';

const LABELS = ['Too short', 'Weak', 'Okay', 'Strong', 'Excellent'];
const COLORS = ['#4b5263', '#ef4444', '#fbbf24', '#2ef2b0', '#38e8ff'];

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-register',
  standalone: true,
  host: { class: 'auth-page auth-page-right block' },
  imports: [IconComponent, RouterLink, TranslatePipe],
  template: `
    <h2 class="text-2xl font-bold tracking-tight">{{ 'Create your identity' | t }} ✨</h2>
    <p class="mt-1 text-sm text-muted">
      {{ 'Your keys are generated here, in this browser.' | t }}
    </p>

    <form
      class="mt-6 space-y-4"
      (submit)="submit($event)"
      (focusin)="warm()"
      [class.anim-shake]="shake()"
    >
      <label class="block">
        <span class="label">{{ 'Username' | t }}</span>
        <input
          class="input mt-1.5"
          name="username"
          autocomplete="username"
          autocapitalize="off"
          spellcheck="false"
          [placeholder]="'3–24 letters, numbers, _ . -' | t"
          [value]="username()"
          (input)="username.set($any($event.target).value)"
          required
        />
        @if (username() && !usernameValid()) {
          <span class="mt-1 block text-xs text-amber">{{
            'Use 3–24 letters, numbers, dots, dashes or underscores.' | t
          }}</span>
        }
      </label>
      <label class="block">
        <span class="label"
          >{{ 'Display name' | t }}
          <span class="normal-case tracking-normal text-dim">({{ 'optional' | t }})</span></span
        >
        <input
          class="input mt-1.5"
          name="displayName"
          maxlength="32"
          [value]="displayName()"
          (input)="displayName.set($any($event.target).value)"
        />
      </label>
      <label class="block">
        <span class="label">{{ 'Password' | t }}</span>
        <div class="relative mt-1.5">
          <input
            class="input pr-11"
            name="password"
            [type]="reveal() ? 'text' : 'password'"
            autocomplete="new-password"
            [placeholder]="'At least 10 characters' | t"
            [value]="password()"
            (input)="password.set($any($event.target).value)"
            required
          />
          <button
            type="button"
            class="btn btn-icon btn-sm btn-ghost absolute right-1.5 top-1.5"
            (click)="reveal.set(!reveal())"
            [attr.aria-label]="(reveal() ? 'Hide password' : 'Show password') | t"
          >
            <app-icon [name]="reveal() ? 'eye' : 'eye-off'" [size]="15" />
          </button>
        </div>
        <div class="mt-2 flex gap-1.5">
          @for (i of [1, 2, 3, 4]; track i) {
            <div
              class="h-1 flex-1 rounded-full transition-[background-color,width] duration-500"
              [style.background]="score() >= i ? color() : 'rgba(255,255,255,.08)'"
            ></div>
          }
        </div>
        <span class="mt-1 block text-xs" [style.color]="color()">{{ label() | t }}</span>
      </label>
      <label class="block">
        <span class="label">{{ 'Confirm password' | t }}</span>
        <div class="relative mt-1.5">
          <input
            class="input pr-11"
            name="confirm"
            [type]="reveal() ? 'text' : 'password'"
            autocomplete="new-password"
            [value]="confirm()"
            (input)="confirm.set($any($event.target).value)"
            required
          />
          <button
            type="button"
            class="btn btn-icon btn-sm btn-ghost absolute right-1.5 top-1.5"
            (click)="reveal.set(!reveal())"
            [attr.aria-label]="(reveal() ? 'Hide password' : 'Show password') | t"
          >
            <app-icon [name]="reveal() ? 'eye' : 'eye-off'" [size]="15" />
          </button>
        </div>
        @if (confirm() && confirm() !== password()) {
          <span class="mt-1 block text-xs text-amber">{{ 'Passwords do not match.' | t }}</span>
        }
      </label>

      <p class="flex gap-2 rounded-ui bg-white/[.04] p-3 text-xs text-muted">
        <app-icon name="key" [size]="15" class="mt-0.5 shrink-0 text-accent" />
        {{
          'If you lose your password an administrator can let you in again, but your message history is lost: the password protects your private keys.'
            | t
        }}
      </p>

      @if (error()) {
        <div
          class="anim-fade-up flex items-start gap-2 rounded-ui border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200"
          role="alert"
        >
          <app-icon name="alert-triangle" [size]="16" /> <span>{{ error() }}</span>
        </div>
      }

      <button class="btn btn-primary h-11 w-full" type="submit" [disabled]="busy() || !canSubmit()">
        @if (busy()) {
          <span
            class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          ></span>
          {{ 'Generating keys…' | t }}
        } @else {
          <app-icon name="shield-check" [size]="16" /> {{ 'Generate keys & join' | t }}
        }
      </button>
    </form>

    <p class="mt-6 text-center text-sm text-muted">
      {{ 'Already have an account?' | t }}
      <a routerLink="/login" class="font-semibold text-accent hover:brightness-125">{{
        'Sign in' | t
      }}</a>
    </p>
  `,
})
export class RegisterComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);
  private readonly arrival = inject(ArrivalService);

  /** Starts loading the app while the person fills the form (see warm-app.ts). */
  protected warm(): void {
    warmApp();
  }

  readonly username = signal('');
  readonly displayName = signal('');
  readonly password = signal('');
  readonly confirm = signal('');
  /** Whether the two password fields show what is typed (the eye button toggles both). */
  readonly reveal = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly shake = signal(false);

  readonly usernameValid = computed(
    function (this: RegisterComponent) {
      return /^[a-zA-Z0-9_.-]{3,24}$/.test(this.username());
    }.bind(this),
  );
  readonly score = computed(
    function (this: RegisterComponent) {
      return passwordScore(this.password());
    }.bind(this),
  );
  readonly label = computed(
    function (this: RegisterComponent) {
      return LABELS[this.score()]!;
    }.bind(this),
  );
  readonly color = computed(
    function (this: RegisterComponent) {
      return COLORS[this.score()]!;
    }.bind(this),
  );
  readonly canSubmit = computed(
    function (this: RegisterComponent) {
      return (
        this.usernameValid() && this.password().length >= 10 && this.password() === this.confirm()
      );
    }.bind(this),
  );

  /**
   * Signs up: creates the keys in the browser and sends only the public ones and the proof of the password.
   */
  async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy() || !this.canSubmit()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.register(
        this.username().trim(),
        this.password(),
        this.displayName().trim() || undefined,
      );
      // The celebration covers the change of page: the app opens behind it.
      await this.arrival.play('register', this.auth.user()?.displayName ?? '');
      await this.router.navigateByUrl('/direct');
    } catch (error) {
      this.error.set(this.i18n.t(describeError(error)));
      this.shake.set(true);
      setTimeout(
        function (this: RegisterComponent) {
          return this.shake.set(false);
        }.bind(this),
        500,
      );
    } finally {
      this.busy.set(false);
    }
  }
}
