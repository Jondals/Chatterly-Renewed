/**
 * src/app/layout/rail.component.ts
 * Group bar: home, every group (with a right-click menu) and create group.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { I18nService, TranslatePipe } from '../core/i18n/i18n.service';
import type { Guild } from '../core/models';
import { ContextMenuService, type MenuItem } from '../core/services/context-menu.service';
import { DialogService } from '../core/services/dialog.service';
import { ToastService } from '../core/services/toast.service';
import { describeError } from '../shared/util/errors';
import { ArrivalService } from '../core/services/arrival.service';
import { SettingsService } from '../core/services/settings.service';
import { isWebTab } from '../core/web-tab';
import { UiService } from '../core/services/ui.service';
import { AvatarComponent } from '../shared/components/avatar.component';
import { IconComponent } from '../shared/components/icon.component';
import { GuildStore } from '../store/guild.store';
import { MessageStore } from '../store/message.store';

/** Slim column with Home, every group, "create group" and settings. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-rail',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, AvatarComponent, IconComponent, TranslatePipe],
  template: `
    <nav
      class="surface flex h-full w-[68px] flex-col items-center gap-2 overflow-y-auto overflow-x-hidden rounded-ui-lg border border-white/6 pb-3 pt-5"
      aria-label="Groups"
    >
      <a
        routerLink="/direct"
        routerLinkActive="active"
        [routerLinkActiveOptions]="{ exact: false }"
        #home="routerLinkActive"
        class="rail-btn tip"
        data-tip-pos="right"
        [attr.data-tip]="'Home' | t"
        (click)="ui.sidebarOpen.set(false)"
      >
        <span class="rail-pill" [class.on]="home.isActive"></span>
        <span
          class="flex h-11 w-11 items-center justify-center rounded-ui-lg bg-white/7 transition-[background-color,color,border-radius,box-shadow,transform] duration-300"
          [class.!bg-accent]="home.isActive"
          [class.text-accent-ink]="home.isActive"
        >
          <app-icon name="home" [size]="21" />
        </span>
        @if (dmUnread() > 0) {
          <span class="badge badge-red absolute -bottom-0.5 -right-0.5 border-2 border-ink-900">{{
            dmUnread()
          }}</span>
        }
      </a>

      <span class="h-px w-8 bg-white/10"></span>

      @for (g of ordered(); track g.id) {
        <a
          [routerLink]="['/groups', g.id]"
          routerLinkActive="active"
          #link="routerLinkActive"
          class="rail-btn tip anim-fade-in"
          [class.is-dragging]="dragging() === g.id"
          [class.drop-before]="overId() === g.id && dropAfter() === false"
          [class.drop-after]="overId() === g.id && dropAfter() === true"
          draggable="true"
          (dragstart)="startDrag($event, g.id)"
          (dragover)="overGroup($event, g.id)"
          (dragleave)="overId.set(null)"
          (drop)="dropGroup($event, g.id)"
          (dragend)="endDrag()"
          data-tip-pos="right"
          [attr.data-tip]="g.name"
          (click)="guilds.setActive(g.id); ui.sidebarOpen.set(false)"
          (contextmenu)="openMenu($event, g)"
        >
          <span class="rail-pill" [class.on]="isCurrent(link.isActive, g.id)"></span>
          <span
            class="block transition-transform duration-300 group-hover:scale-105"
            [class.scale-100]="isCurrent(link.isActive, g.id)"
          >
            <app-avatar [imageId]="g.iconImage" [name]="g.name" shape="square" [size]="44" />
          </span>
          @if (unread(g.id) > 0) {
            <span class="badge badge-red absolute -bottom-0.5 -right-0.5 border-2 border-ink-900">{{
              unread(g.id)
            }}</span>
          }
        </a>
      }

      <button
        type="button"
        class="rail-btn tip"
        data-tip-pos="right"
        [attr.data-tip]="'Create a group' | t"
        (click)="ui.createGuildOpen.set(true)"
      >
        <span
          class="flex h-11 w-11 items-center justify-center rounded-ui-lg border border-dashed border-white/20 text-muted transition-[background-color,color,border-color] duration-300 hover:border-accent hover:bg-accent/10 hover:text-accent"
        >
          <app-icon name="plus" [size]="20" />
        </span>
      </button>
      @if (web) {
        <!-- Only in a browser tab: back to the first page of the web (download, apps). -->
        <button
          type="button"
          class="rail-btn tip"
          data-tip-pos="right"
          [attr.data-tip]="'Back to the website' | t"
          [attr.aria-label]="'Back to the website' | t"
          (click)="toWebsite()"
        >
          <span
            class="flex h-11 w-11 items-center justify-center rounded-ui-lg bg-white/7 text-muted transition-[background-color,color] duration-300 hover:bg-accent/15 hover:text-accent"
          >
            <app-icon name="globe" [size]="20" />
          </span>
        </button>
      }
    </nav>
  `,
  styles: `
    .rail-btn {
      position: relative;
      display: block;
      border-radius: var(--r-lg);
    }
    .rail-btn:active {
      transform: scale(0.94);
    }
    .rail-btn.is-dragging {
      opacity: 0.35;
    }
    .rail-btn.drop-before::after,
    .rail-btn.drop-after::after {
      content: '';
      position: absolute;
      left: 4px;
      right: 4px;
      height: 3px;
      border-radius: 3px;
      background: var(--accent);
      box-shadow: 0 0 10px var(--accent);
    }
    .rail-btn.drop-before::after {
      top: -6px;
    }
    .rail-btn.drop-after::after {
      bottom: -6px;
    }
    .rail-pill {
      position: absolute;
      left: -12px;
      top: 50%;
      width: 4px;
      height: 8px;
      border-radius: 0 4px 4px 0;
      background: var(--fg);
      transform: translateY(-50%) scaleY(0);
      opacity: 0;
      transition:
        transform 0.3s var(--ease),
        height 0.3s var(--ease),
        opacity 0.2s;
    }
    .rail-btn:hover .rail-pill {
      transform: translateY(-50%) scaleY(1);
      opacity: 0.7;
    }
    .rail-pill.on {
      height: 28px;
      background: var(--accent);
      transform: translateY(-50%) scaleY(1);
      opacity: 1;
    }
  `,
})
export class RailComponent {
  protected readonly ui = inject(UiService);
  protected readonly guilds = inject(GuildStore);
  private readonly messages = inject(MessageStore);
  private readonly router = inject(Router);
  /** True while the page of a call is open. */
  private readonly onCallPage = toSignal(
    this.router.events.pipe(
      filter(function ended(event) {
        return event instanceof NavigationEnd;
      }),
      map(
        function (this: RailComponent) {
          return this.router.url.startsWith('/voice');
        }.bind(this),
      ),
    ),
    { initialValue: this.router.url.startsWith('/voice') },
  );

  /** A group is the current one on its own page and on the call page of a call started from it. */
  protected isCurrent(onItsPage: boolean, id: string): boolean {
    return onItsPage || (this.onCallPage() && this.ui.lastRoute.startsWith('/groups/' + id));
  }
  private readonly menu = inject(ContextMenuService);
  private readonly arrival = inject(ArrivalService);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly settings = inject(SettingsService);
  /** Back to the first page of the web with its own transition, not the one of signing out (and not with a cut). */
  protected async toWebsite(): Promise<void> {
    await this.arrival.play('leave');
    await this.router.navigateByUrl('/');
  }

  /** In a browser tab only: the button back to the website. */
  protected readonly web = isWebTab();
  /** The group being dragged, the one under it and whether it would go after that one. */
  protected readonly dragging = signal<string | null>(null);
  protected readonly overId = signal<string | null>(null);
  protected readonly dropAfter = signal(false);
  /** The groups in the order the person arranged them. */
  protected readonly ordered = computed(this.sortGuilds.bind(this));

  /** The groups in the saved order (the ones without a place yet, last, as they come). */
  private sortGuilds(): Guild[] {
    const order = this.settings.guildOrder();
    const list = this.guilds.guilds().slice();
    const place = function placeOf(id: string): number {
      const index = order.indexOf(id);
      return index < 0 ? order.length : index;
    };
    return list.sort(function byPlace(a, b) {
      return place(a.id) - place(b.id);
    });
  }

  /** Starts dragging a group. */
  protected startDrag(event: DragEvent, id: string): void {
    this.dragging.set(id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', id);
    }
  }

  /** The dragged group is over another one: it would go before or after it. */
  protected overGroup(event: DragEvent, id: string): void {
    if (!this.dragging() || this.dragging() === id) {
      return;
    }
    event.preventDefault();
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.overId.set(id);
    this.dropAfter.set(event.clientY > box.top + box.height / 2);
  }

  /** The group was dropped: it takes its new place and the order is kept. */
  protected dropGroup(event: DragEvent, id: string): void {
    event.preventDefault();
    const moved = this.dragging();
    if (moved && moved !== id) {
      const ids = this.ordered()
        .map(function idOf(g) {
          return g.id;
        })
        .filter(function others(other) {
          return other !== moved;
        });
      const at = ids.indexOf(id) + (this.dropAfter() ? 1 : 0);
      ids.splice(at, 0, moved);
      this.settings.guildOrder.set(ids);
    }
    this.endDrag();
  }

  /** Dragging ended (dropped or cancelled). */
  protected endDrag(): void {
    this.dragging.set(null);
    this.overId.set(null);
  }
  private readonly i18n = inject(I18nService);

  protected readonly dmUnread = computed(
    function (this: RailComponent) {
      const counts = this.messages.unread();
      const groupChannels = new Set(
        this.guilds.guilds().flatMap(function (g) {
          return g.channels.map(function (c) {
            return c.id;
          });
        }),
      );
      return Object.entries(counts)
        .filter(function ([id]) {
          return !groupChannels.has(id);
        })
        .reduce(function (n, [, c]) {
          return n + c;
        }, 0);
    }.bind(this),
  );

  /** The unread messages of a group. */
  protected unread(guildId: string): number {
    const g = this.guilds.guild(guildId);
    const counts = this.messages.unread();
    return g
      ? g.channels.reduce(function (n, c) {
          return n + (counts[c.id] ?? 0);
        }, 0)
      : 0;
  }

  /** Right click on a group: invite, settings and (for the owner) delete it. */
  protected openMenu(event: MouseEvent, grupo: Guild): void {
    const items: MenuItem[] = [
      {
        label: 'Invite people',
        icon: 'user-plus',
        action: function (this: RailComponent) {
          return this.alDe(
            grupo,
            function (this: RailComponent) {
              return this.ui.inviteOpen.set(true);
            }.bind(this),
          );
        }.bind(this),
      },
      {
        label: 'Group settings',
        icon: 'settings',
        action: function (this: RailComponent) {
          return this.alDe(
            grupo,
            function (this: RailComponent) {
              return this.ui.guildSettingsOpen.set(true);
            }.bind(this),
          );
        }.bind(this),
      },
    ];
    if (this.guilds.isOwner(grupo)) {
      items.push({
        label: 'Delete group',
        icon: 'trash',
        danger: true,
        separator: true,
        action: function (this: RailComponent) {
          return void this.confirmDelete(grupo);
        }.bind(this),
      });
    }
    this.menu.open(event, items);
  }

  /** Opens the group (so the menus act on it) and runs the action. */
  private alDe(grupo: Guild, accion: () => void): void {
    this.guilds.setActive(grupo.id);
    void this.router.navigate(['/groups', grupo.id]).then(accion);
  }

  /** Asks to confirm and deletes a group. */
  private async confirmDelete(grupo: Guild): Promise<void> {
    const t = function (this: RailComponent, k: string, p?: Record<string, string>) {
      return this.i18n.t(k, p);
    }.bind(this);
    if (
      !(await this.dialog.confirm(
        t('Delete {name}?', { name: grupo.name }),
        t('This permanently deletes every channel, message and file. It cannot be undone.'),
        { danger: true, confirmLabel: t('Delete forever') },
      ))
    )
      return;
    try {
      await this.guilds.deleteGuild(grupo.id);
      if (this.router.url.includes(grupo.id)) void this.router.navigateByUrl('/direct');
    } catch (e) {
      this.toast.error(t('Could not delete the group'), describeError(e));
    }
  }

  /** Opens the settings. */
  protected openSettings(): void {
    this.ui.openSettings();
  }
}
