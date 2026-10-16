/**
 * src/app/layout/guest-bar.component.ts
 * What a guest sees all the time (the web only): that nothing is kept, and the way to leave or to make a real account. A guest
 * is an account made to try the app; it is erased when they leave or close the page.
 */
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '../core/i18n/i18n.service';
import { AuthService } from '../core/services/auth.service';
import { IconComponent } from '../shared/components/icon.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-guest-bar',
  standalone: true,
  imports: [IconComponent, TranslatePipe],
  template: `
    @if (auth.isGuest()) {
      <div
        class="fixed bottom-3 left-1/2 z-[70] flex w-[min(40rem,calc(100%-1.5rem))] -translate-x-1/2 flex-wrap items-center gap-x-3 gap-y-2 rounded-ui-lg border border-accent/30 bg-ink-900/90 px-4 py-2.5 text-sm shadow-2xl backdrop-blur-md"
        role="status"
      >
        <app-icon name="info" [size]="16" class="shrink-0 text-accent" />
        <span class="min-w-0 flex-1 text-xs text-muted">{{
          'You are a guest: nothing you do is saved, and it is all erased when you leave or close the page.'
            | t
        }}</span>
        <button type="button" class="btn btn-sm btn-primary" (click)="register()">
          {{ 'Create an account' | t }}
        </button>
        <button type="button" class="btn btn-sm" (click)="leave()">{{ 'Leave' | t }}</button>
      </div>
    }
  `,
})
export class GuestBarComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Leaves: the guest account is erased, and the first page opens. */
  protected async leave(): Promise<void> {
    await this.auth.logout(true);
    await this.router.navigateByUrl('/');
  }

  /** Leaves too, and opens the registration (what a guest did is not carried over: it was not saved). */
  protected async register(): Promise<void> {
    await this.auth.logout(true);
    await this.router.navigateByUrl('/register');
  }
}
