/**
 * src/app/layout/announcement-bar.component.ts
 * The announcement of the server (see AnnouncementService): a short bar at the top of the window, over everything, with a
 * cross to hide it. An administrator writes it in Settings > Administration > Server.
 * ! The text is drawn as text (interpolation), never as markup.
 */
import { Component, inject } from '@angular/core';
import { TranslatePipe } from '../core/i18n/i18n.service';
import { AnnouncementService } from '../core/services/announcement.service';
import { IconComponent } from '../shared/components/icon.component';

@Component({
  selector: 'app-announcement-bar',
  standalone: true,
  imports: [IconComponent, TranslatePipe],
  template: `
    @if (announcements.visible(); as a) {
      <div
        class="anim-fade-in fixed left-1/2 top-3 z-[70] flex w-[min(44rem,calc(100%-1.5rem))] -translate-x-1/2 items-start gap-3 rounded-ui-lg border px-4 py-3 text-sm shadow-2xl backdrop-blur-md"
        [class]="
          a.tone === 'warning'
            ? 'border-amber-400/30 bg-amber-950/85 text-amber-100'
            : 'border-accent/30 bg-ink-900/90 text-fg'
        "
        role="status"
      >
        <app-icon
          [name]="a.tone === 'warning' ? 'alert-triangle' : 'bell'"
          [size]="17"
          class="mt-0.5 shrink-0"
          [class.text-amber-300]="a.tone === 'warning'"
          [class.text-accent]="a.tone !== 'warning'"
        />
        <div class="min-w-0 flex-1">
          <b class="block text-[0.6875rem] uppercase tracking-wider opacity-70">{{
            'From the administrators' | t
          }}</b>
          <p class="whitespace-pre-line break-words">{{ a.text }}</p>
        </div>
        <button
          type="button"
          class="btn btn-icon btn-sm btn-ghost shrink-0"
          [attr.aria-label]="'Hide' | t"
          (click)="announcements.hide()"
        >
          <app-icon name="x" [size]="15" />
        </button>
      </div>
    }
  `,
})
export class AnnouncementBarComponent {
  protected readonly announcements = inject(AnnouncementService);
}
