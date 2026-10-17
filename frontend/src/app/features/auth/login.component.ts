/**
 * src/app/features/auth/login.component.ts
 * Sign-in form.
 */
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import { isWebTab } from '../../core/web-tab';
import { warmApp } from '../../core/warm-app';
import { AuthService, IdentityResetPending } from '../../core/services/auth.service';
import { IconComponent } from '../../shared/components/icon.component';
import { describeError } from '../../shared/util/errors';
import { ArrivalService } from '../../core/services/arrival.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-login',
  standalone: true,
  host: { class: 'auth-page auth-page-left block' },
  imports: [IconComponent, RouterLink, TranslatePipe],
  template: `
    @if (mode() === 'reset') {
      <h2 class="text-2xl font-bold tracking-tight">{{ 'Choose your new password' | t }}</h2>
      <p class="mt-1 text-sm text-muted">
        {{
          'An administrator gave you a temporary password. Choose one of your own: it makes new keys for your account. Messages that were encrypted with the old keys cannot be read any more.'
            | t
        }}
      </p>
      <form class="mt-6 space-y-4" (submit)="finishReset($event)" autocomplete="on">
        <label class="block">
          <span class="label">{{ 'New password' | t }}</span>
          <input
            class="input mt-1.5"
            name="new-password"
            type="password"
            autocomplete="new-password"
            [value]="newPassword()"
            (input)="newPassword.set($any($event.target).value)"
            required
          />
        </label>
        <label class="block">
          <span class="label">{{ 'Confirm password' | t }}</span>
          <input
            class="input mt-1.5"
            name="confirm-password"
            type="password"
            autocomplete="new-password"
            [value]="confirm()"
            (input)="confirm.set($any($event.target).value)"
            required
          />
        </label>
        @if (error()) {
          <div class="flex items-start gap-2 rounded-ui border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200" role="alert">
            <app-icon name="alert-triangle" [size]="16" /> <span>{{ error() }}</span>
          </div>
        }
        <button class="btn btn-primary h-11 w-full" type="submit" [disabled]="busy() || !resetReady()">
          {{ 'Set the password' | t }}
        </button>
      </form>
    } @else if (mode() === 'help') {
      <h2 class="text-2xl font-bold tracking-tight">{{ 'Cannot sign in?' | t }}</h2>
      <p class="mt-1 text-sm text-muted">
        {{
          'Tell the administrators. One of them sets a temporary password and gives it to you; then you choose your own. Your old encrypted messages cannot be recovered: nobody has your keys.'
            | t
        }}
      </p>
      <label class="mt-6 block">
        <span class="label">{{ 'Username' | t }}</span>
        <input
          class="input mt-1.5"
          name="username"
          autocapitalize="off"
          spellcheck="false"
          [value]="username()"
          (input)="username.set($any($event.target).value)"
        />
      </label>
      @if (sent()) {
        <p class="mt-4 text-sm text-accent">
          {{ 'Sent. When an administrator sets a temporary password, sign in with it.' | t }}
        </p>
      }
      @if (error()) {
        <p class="mt-4 text-sm text-red-200" role="alert">{{ error() }}</p>
      }
      <button
        type="button"
        class="btn btn-primary mt-4 h-11 w-full"
        [disabled]="busy() || !username() || sent()"
        (click)="askHelp()"
      >
        {{ 'Tell the administrators' | t }}
      </button>
      <button type="button" class="btn btn-ghost mt-2 h-10 w-full" (click)="mode.set('in')">
        {{ 'Back' | t }}
      </button>
    } @else {
    <h2 class="text-2xl font-bold tracking-tight">{{ 'Welcome back' | t }}</h2>
    <p class="mt-1 text-sm text-muted">{{ 'Sign in to unlock your encrypted vault.' | t }}</p>

    <form
      class="mt-6 space-y-4"
      (submit)="submit($event)"
      (focusin)="warm()"
      [class.anim-shake]="shake()"
      autocomplete="on"
    >
      <label class="block">
        <span class="label">{{ 'Username' | t }}</span>
        <input
          class="input mt-1.5"
          name="username"
          autocomplete="username"
          autocapitalize="off"
          spellcheck="false"
          [value]="username()"
          (input)="username.set($any($event.target).value)"
          required
        />
      </label>
      <label class="block">
        <span class="label">{{ 'Password' | t }}</span>
        <div class="relative mt-1.5">
          <input
            class="input pr-11"
            name="password"
            [type]="reveal() ? 'text' : 'password'"
            autocomplete="current-password"
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
      </label>

      @if (error()) {
        <div
          class="anim-fade-up flex items-start gap-2 rounded-ui border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200"
          role="alert"
        >
          <app-icon name="alert-triangle" [size]="16" /> <span>{{ error() }}</span>
        </div>
      }

      <button
        class="btn btn-primary h-11 w-full"
        type="submit"
        [disabled]="busy() || !username() || !password()"
      >
        @if (busy()) {
          <span
            class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          ></span>
          {{ 'Unlocking…' | t }}
        } @else {
          {{ 'Sign in' | t }}
        }
      </button>
    </form>

    <p class="mt-4 text-center text-sm">
      <button type="button" class="text-dim underline hover:text-fg" (click)="mode.set('help')">
        {{ 'Cannot sign in?' | t }}
      </button>
    </p>
    <p class="mt-3 text-center text-sm text-muted">
      {{ 'New here?' | t }}
      <a routerLink="/register" class="font-semibold text-accent hover:brightness-125">{{
        'Create an account' | t
      }}</a>
    </p>
    @if (web) {
      <p class="mt-2 text-center text-xs text-dim">
        <a routerLink="/" class="underline hover:text-fg">{{ 'Download the app or try it as a guest' | t }}</a>
      </p>
    }
    }
  `,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly i18n = inject(I18nService);
  private readonly arrival = inject(ArrivalService);

  /** The web (not an app): it has the first page, with the download and the guest mode. */
  protected readonly web = isWebTab();

  /** Starts loading the app while the person fills the form (see warm-app.ts). */
  protected warm(): void {
    warmApp();
  }

  readonly username = signal('');
  readonly password = signal('');
  readonly reveal = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly shake = signal(false);
  /** Which form shows: sign in, ask the administrators for help, or choose the new password after a reset. */
  readonly mode = signal<'in' | 'help' | 'reset'>('in');
  readonly newPassword = signal('');
  readonly confirm = signal('');
  readonly sent = signal(false);

  protected resetReady(): boolean {
    return this.newPassword().length >= 10 && this.newPassword() === this.confirm();
  }

  /** Tells the administrators that this person cannot sign in. */
  protected async askHelp(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.requestRecovery(this.username().trim());
      this.sent.set(true);
    } catch (error) {
      this.error.set(this.i18n.t(describeError(error)));
    } finally {
      this.busy.set(false);
    }
  }

  /** Makes the new keys after an administrator reset the password. */
  protected async finishReset(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy() || !this.resetReady()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.finishReset(this.newPassword());
      await this.enter();
    } catch (error) {
      this.error.set(this.i18n.t(describeError(error)));
    } finally {
      this.busy.set(false);
    }
  }

  private async enter(): Promise<void> {
    // The transition covers the change of page: the app opens behind it.
    await this.arrival.play('login', this.auth.user()?.displayName ?? '');
    // From the first page of the web the person comes back to it, now in their own theme, and opens the app from there.
    await this.router.navigateByUrl(
      this.route.snapshot.queryParamMap.get('from') === 'welcome' ? '/' : '/direct',
    );
  }

  /** Signs in: derives the keys from the password in the browser and sends only the proof. */
  async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.login(this.username().trim(), this.password());
      await this.enter();
    } catch (error) {
      if (error instanceof IdentityResetPending) {
        this.password.set('');
        this.mode.set('reset');
        return;
      }
      this.error.set(this.i18n.t(describeError(error)));
      this.shake.set(true);
      setTimeout(
        function (this: LoginComponent) {
          return this.shake.set(false);
        }.bind(this),
        500,
      );
    } finally {
      this.busy.set(false);
    }
  }
}
