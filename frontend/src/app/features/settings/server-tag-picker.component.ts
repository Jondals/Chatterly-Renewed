/**
 * src/app/features/settings/server-tag-picker.component.ts
 * In My profile: the person chooses which of the tags of their groups to show next to their name (or none).
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import type { User } from '../../core/models';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { DirectoryService } from '../../core/services/directory.service';
import { GuildStore } from '../../store/guild.store';
import { ServerTagComponent } from '../../shared/components/server-tag.component';

/** Chooses the tag of a group to show. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-server-tag-picker',
  standalone: true,
  imports: [ServerTagComponent, TranslatePipe],
  template: `
    <section class="panel-flat mt-4 p-3.5">
      <div class="text-sm font-semibold">{{ 'Server tag' | t }}</div>
      <p class="mb-2.5 mt-0.5 text-xs text-muted">
        {{
          'A tag that a group gave you. It shows next to your name, and shows that you belong to that group. You can hide it any time.'
            | t
        }}
      </p>
      @if (options().length === 0) {
        <p class="text-xs text-dim">
          {{
            'None of your groups has a tag yet. The owner of a group makes it in its settings.' | t
          }}
        </p>
      } @else {
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="choice-card !min-h-0 px-3 py-2 text-xs"
            [class.is-on]="!current()"
            [disabled]="busy()"
            (click)="choose(null)"
          >
            {{ 'No tag' | t }}
          </button>
          @for (g of options(); track g.id) {
            <button
              type="button"
              class="choice-card !min-h-0 flex items-center gap-2 px-3 py-2 text-xs"
              [class.is-on]="current() === g.id"
              [disabled]="busy()"
              (click)="choose(g.id)"
            >
              <app-server-tag [tag]="g.tag" />
              <span class="max-w-28 truncate text-muted">{{ g.name }}</span>
            </button>
          }
        </div>
      }
    </section>
  `,
})
export class ServerTagPickerComponent {
  private readonly guilds = inject(GuildStore);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly directory = inject(DirectoryService);
  protected readonly busy = signal(false);
  /** The groups of the person that have a tag. */
  protected readonly options = computed(this.pickOptions.bind(this));
  /** The group whose tag is shown now. */
  protected readonly current = computed(this.pickCurrent.bind(this));

  /** The groups that have a tag. */
  private pickOptions() {
    return this.guilds.guilds().filter(function tagged(g) {
      return !!g.tag?.text;
    });
  }

  /** The group of the tag that is shown. */
  private pickCurrent(): string | null {
    return this.auth.user()?.serverTag?.guildId ?? null;
  }

  /** Shows the tag of a group (or none). */
  protected async choose(guildId: string | null): Promise<void> {
    this.busy.set(true);
    try {
      const res = await this.api.patch<{ user: User }>('/api/me', { tagGuild: guildId });
      this.auth.setUser(res.user);
      this.directory.merge([res.user]);
    } finally {
      this.busy.set(false);
    }
  }
}
