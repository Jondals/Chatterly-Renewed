/**
 * src/app/features/settings/delete-account.component.ts
 * The "Delete account" card of My profile and the window that asks for the username and the password before erasing it.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { AuthService } from '../../core/services/auth.service';
import { IconComponent } from '../../shared/components/icon.component';
import { ModalComponent } from '../../shared/components/modal.component';
import { describeError } from '../../shared/util/errors';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-delete-account',
  standalone: true,
  imports: [IconComponent, ModalComponent, TranslatePipe],
  template: `
    <section class="mt-6 rounded-ui-lg border border-red-400/20 bg-red-500/[.04] p-5">
      <h2 class="mb-1 flex items-center gap-2 text-sm font-semibold text-red-300">
        <app-icon name="trash" [size]="16" /> {{ 'Delete account' | t }}
      </h2>
      <p class="mb-3 text-sm text-muted">
        {{
          'Erases your account for good: your messages, files, friends and direct chats. A group you own goes to its longest-standing member. It cannot be undone.'
            | t
        }}
      </p>
      <button class="btn btn-sm btn-soft-danger" type="button" (click)="open.set(true)">
        <app-icon name="trash" [size]="14" /> {{ 'Delete my account' | t }}
      </button>
    </section>

    @if (open()) {
      <app-modal
        [title]="'Delete account' | t"
        [subtitle]="'This cannot be undone.' | t"
        (closed)="close()"
      >
        <form class="space-y-3" (submit)="erase($event)">
          <ul class="list-disc space-y-1 pl-5 text-sm text-muted">
            <li>
              {{ 'Your messages, files, reactions and pictures are erased from the server.' | t }}
            </li>
            <li>{{ 'Your friendships and direct chats disappear.' | t }}</li>
            <li>
              {{
                'The groups you own pass to the member who has been in them the longest (a group with nobody else is deleted); in the others you just leave.'
                  | t
              }}
            </li>
            <li>
              {{
                'Your keys, your preferences and everything kept on this device are erased too.' | t
              }}
            </li>
          </ul>
          <input
            class="input"
            type="text"
            autocomplete="off"
            [placeholder]="'Type your username to confirm' | t"
            [value]="confirmName()"
            (input)="confirmName.set($any($event.target).value)"
          />
          <input
            class="input"
            type="password"
            autocomplete="current-password"
            [placeholder]="'Your password' | t"
            [value]="password()"
            (input)="password.set($any($event.target).value)"
          />
          @if (error()) {
            <p class="text-sm text-red-300">{{ error() }}</p>
          }
          <div class="flex justify-end gap-2">
            <button class="btn" type="button" (click)="close()">{{ 'Cancel' | t }}</button
            ><button class="btn btn-danger" type="submit" [disabled]="!canDelete() || busy()">
              @if (busy()) {
                {{ 'Erasing…' | t }}
              } @else {
                {{ 'Delete my account forever' | t }}
              }
            </button>
          </div>
        </form>
      </app-modal>
    }
  `,
})
export class DeleteAccountComponent {
  private readonly auth = inject(AuthService);

  protected readonly open = signal(false);
  protected readonly confirmName = signal('');
  protected readonly password = signal('');
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  /** The account can be erased when the username was typed right and a password is there. */
  protected readonly canDelete = computed(
    function (this: DeleteAccountComponent) {
      return (
        this.confirmName().trim().toLowerCase() === this.auth.user()?.username.toLowerCase() &&
        this.password().length > 0
      );
    }.bind(this),
  );

  /** Closes the window and forgets what was typed in it. */
  protected close(): void {
    this.open.set(false);
    this.confirmName.set('');
    this.password.set('');
    this.error.set('');
  }

  /** Erases the account (the server checks the proof of the password) and starts again from the sign-in page. */
  protected async erase(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canDelete()) {
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.deleteAccount(this.auth.user()!.username, this.password());
      // A new load of the page leaves nothing of the account in memory (keys, open calls, sockets).
      window.location.assign('/login');
    } catch (e) {
      this.error.set(describeError(e));
      this.busy.set(false);
    }
  }
}
