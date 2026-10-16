/**
 * src/app/layout/incoming-call.component.ts
 * Incoming call notice with accept and decline.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '../core/i18n/i18n.service';
import { CallService } from '../core/services/call.service';
import { DirectoryService } from '../core/services/directory.service';
import { AvatarComponent } from '../shared/components/avatar.component';
import { IconComponent } from '../shared/components/icon.component';
import { NameColorDirective } from '../shared/util/name-color.directive';
import { UserFontDirective } from '../shared/util/user-font.directive';
import { NameFxDirective } from '../shared/util/name-fx.directive';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-incoming-call',
  standalone: true,
  imports: [
    AvatarComponent,
    IconComponent,
    NameColorDirective,
    NameFxDirective,
    TranslatePipe,
    UserFontDirective,
  ],
  template: `
    @if (call.incoming(); as inc) {
      <div class="anim-pop fixed left-1/2 top-5 z-[90] -translate-x-1/2">
        <div
          class="panel flex items-center gap-4 p-4 pr-5 shadow-[0_20px_60px_-12px_rgba(0,0,0,.8)]"
        >
          <div class="relative">
            <span
              class="absolute inset-0 rounded-full border-2 border-accent"
              style="animation: ring-out 1.8s ease-out infinite"
            ></span>
            <app-avatar [user]="caller()" [size]="52" />
          </div>
          <div class="min-w-[9rem]">
            <div class="flex items-center gap-1 text-xs font-semibold text-accent">
              <app-icon name="lock" [size]="11" /> {{ 'Incoming encrypted call' | t }}
            </div>
            <div
              class="text-base font-bold"
              [appNameColor]="caller()?.profileColor"
              [appUserFont]="caller()?.nameFont"
              [nameFx]="caller()?.nameFx"
            >
              {{ caller()?.displayName ?? '…' }}
            </div>
          </div>
          <button
            class="btn btn-icon btn-danger"
            type="button"
            (click)="call.dismissIncoming()"
            [attr.aria-label]="'Decline' | t"
          >
            <app-icon name="phone-off" [size]="18" />
          </button>
          <button
            class="btn btn-icon btn-primary ring-shake"
            type="button"
            (click)="accept()"
            [attr.aria-label]="'Accept' | t"
          >
            <app-icon name="phone" [size]="18" />
          </button>
        </div>
      </div>
    }
  `,
})
export class IncomingCallComponent {
  protected readonly call = inject(CallService);
  private readonly directory = inject(DirectoryService);
  private readonly router = inject(Router);
  protected readonly caller = computed(
    function (this: IncomingCallComponent) {
      const id = this.call.incoming()?.from;
      return id ? this.directory.users().get(id) : undefined;
    }.bind(this),
  );

  /** Accepts the call: the call page opens and the call starts. */
  async accept(): Promise<void> {
    await this.router.navigateByUrl('/voice');
    await this.call.acceptIncoming();
  }
}
