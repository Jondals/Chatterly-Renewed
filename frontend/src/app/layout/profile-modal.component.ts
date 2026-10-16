/**
 * src/app/layout/profile-modal.component.ts
 * Window with the profile card of another user (opened by pressing their name in a message).
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../core/services/auth.service';
import { DirectoryService } from '../core/services/directory.service';
import { UiService } from '../core/services/ui.service';
import { ModalComponent } from '../shared/components/modal.component';
import { ProfileCardComponent } from '../shared/components/profile-card.component';
import { SocialStore } from '../store/social.store';

/** Shows the profile of the chosen user and closes with Esc or by pressing outside. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-profile-modal',
  standalone: true,
  imports: [ModalComponent, ProfileCardComponent],
  template: `
    @if (usuario(); as u) {
      <app-modal
        [title]="u.displayName"
        [subtitle]="inGroup() ? '' : '@' + u.username"
        [width]="380"
        (closed)="ui.profileUserId.set(null)"
      >
        <app-profile-card [user]="u" [status]="social.statusOf(u.id)" [showHandle]="!inGroup()" />
      </app-modal>
    }
  `,
})
export class ProfileModalComponent {
  protected readonly ui = inject(UiService);
  protected readonly social = inject(SocialStore);
  private readonly directory = inject(DirectoryService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly usuario = computed(this.findUser.bind(this));

  /** True while a group is on screen: there the "@username" is not shown. */
  protected inGroup(): boolean {
    return this.router.url.startsWith('/groups');
  }

  /** The user whose profile is open. */
  private findUser(): ReturnType<DirectoryService['get']> {
    const id = this.ui.profileUserId();
    const own = this.auth.user();
    return id ? (this.directory.users().get(id) ?? (own?.id === id ? own : undefined)) : undefined;
  }
}
