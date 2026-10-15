/**
 * src/app/features/auth/login.component.ts
 * Sign-in form.
 */
import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import { AuthService } from '../../core/services/auth.service';
import { IconComponent } from '../../shared/components/icon.component';
import { describeError } from '../../shared/util/errors';
import { ArrivalService } from '../../core/services/arrival.service';

@Component({
  selector: 'app-login',
  standalone: true,
  host: { class: 'auth-page auth-page-left block' },
  imports: [IconComponent, RouterLink, TranslatePipe],
  template: `
    <h2 class="text-2xl font-bold tracking-tight">{{ 'Welcome back' | t }}</h2>
    <p class="mt-1 text-sm text-muted">{{ 'Sign in to unlock your encrypted vault.' | t }}</p>

    <form
      class="mt-6 space-y-4"
      (submit)="submit($event)"
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

    <p class="mt-6 text-center text-sm text-muted">
      {{ 'New here?' | t }}
      <a routerLink="/register" class="font-semibold text-accent hover:brightness-125">{{
        'Create an account' | t
      }}</a>
    </p>
  `,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);
  private readonly arrival = inject(ArrivalService);

  readonly username = signal('');
  readonly password = signal('');
  readonly reveal = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly shake = signal(false);

  /** Signs in: derives the keys from the password in the browser and sends only the proof. */
  async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.login(this.username().trim(), this.password());
      // The transition covers the change of page: the app opens behind it.
      await this.arrival.play('login', this.auth.user()?.displayName ?? '');
      await this.router.navigateByUrl('/direct');
    } catch (error) {
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
