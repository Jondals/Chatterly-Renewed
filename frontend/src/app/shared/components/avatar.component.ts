/**
 * src/app/shared/components/avatar.component.ts
 * Profile picture or initials, with ring, status dot and a highlight while speaking.
 */
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import type { PresenceStatus, User } from '../../core/models';
import { ImageService } from '../../core/services/image.service';
import { ViewerService } from '../../core/services/viewer.service';

const STATUS_COLORS: Record<PresenceStatus, string> = {
  online: '#2ef2b0',
  idle: '#fbbf24',
  dnd: '#ef4444',
  offline: '#4b5263',
};

/**
 * Profile picture (uploaded image, or a coloured monogram), with optional presence dot, aura ring and
 * speaking highlight. Use `shape="square"` for group icons.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-avatar',
  standalone: true,
  template: `
    <div class="relative inline-block" [style.width.px]="size()" [style.height.px]="size()">
      <div
        class="h-full w-full"
        [class.rounded-full]="shape() === 'circle'"
        [class.aura]="!!auraClass() && shape() === 'circle' && !!user()"
        [class]="auraClass()"
        [style.--ring.px]="ringPx()"
        [style.--a1]="auraColors()[0]"
        [style.--a2]="auraColors()[1]"
        [class.speaking-ring]="speaking()"
        [style.border-radius]="shape() === 'square' ? 'var(--r-lg)' : null"
      >
        <div
          class="aura-core flex h-full w-full select-none items-center justify-center overflow-hidden font-bold text-ink-950"
          [class.rounded-full]="shape() === 'circle'"
          [style.border-radius]="shape() === 'square' ? 'var(--r-lg)' : null"
          [style.background]="shown() ? '#111' : background()"
          [style.fontSize.px]="size() * 0.4"
        >
          @if (shown(); as url) {
            <img decoding="async" loading="lazy"
              [src]="url"
              alt=""
              draggable="false"
              class="anim-fade-in h-full w-full object-cover"
            />
          } @else {
            {{ initials() }}
          }
        </div>
      </div>
      @if (status() !== null) {
        <span
          class="absolute rounded-full border-2 border-ink-900"
          [style.bottom.px]="dotOffset()"
          [style.right.px]="dotOffset()"
          [style.width.px]="dot()"
          [style.height.px]="dot()"
          [style.background]="statusColor()"
        ></span>
      }
    </div>
  `,
  host: {
    class: 'inline-block shrink-0 align-middle',
    '(click)': 'zoom($event)',
    '[class.cursor-zoom-in]': 'zoomable() && !!src()',
  },
})
export class AvatarComponent {
  readonly user = input<User | undefined | null>(undefined);
  /** Overrides for non-user uses (group icons). */
  readonly imageId = input<string | null | undefined>(undefined);
  readonly name = input<string | undefined>(undefined);
  readonly color = input<string | undefined>(undefined);
  readonly shape = input<'circle' | 'square'>('circle');
  readonly size = input(40);
  readonly status = input<PresenceStatus | null>(null);
  readonly aura = input(false);
  /** How thick the ring of the effect is, as a part of the size of the picture (a big picture in a call wants a thinner one). */
  readonly ringRatio = input(0.14);
  readonly speaking = input(false);
  /** True where the picture moves all the time (the preview of a profile, a profile card), not only under the pointer. */
  readonly animated = input(false);
  /** True where pressing the picture opens it big. */
  readonly zoomable = input(false);

  private readonly images = inject(ImageService);
  private readonly viewer = inject(ViewerService);
  private readonly resolvedImage = computed(
    function (this: AvatarComponent) {
      return this.imageId() ?? this.user()?.avatarImage ?? null;
    }.bind(this),
  );
  protected readonly src = computed(
    function (this: AvatarComponent) {
      return this.images.url(this.resolvedImage());
    }.bind(this),
  );
  /** Whether the pointer is over the picture (a picture that moves moves only then). */
  protected readonly hover = signal(false);
  /** What is shown: the picture that moves under the pointer, its first frame the rest of the time. */
  protected readonly shown = computed(
    function (this: AvatarComponent) {
      const still = this.images.still(this.resolvedImage());
      return this.animated() || this.hover() || !still ? this.src() : still;
    }.bind(this),
  );
  protected readonly auraClass = computed(
    function (this: AvatarComponent) {
      const aura = this.user()?.aura;
      return this.aura() && aura && aura !== 'void' ? 'aura-' + aura : '';
    }.bind(this),
  );
  /** The two colors of the ring (null follows the theme). */
  protected readonly auraColors = computed(
    function (this: AvatarComponent): (string | null)[] {
      const parts = (this.user()?.auraColor ?? '').split(',');
      return parts.length === 2 ? parts : [null, null];
    }.bind(this),
  );
  /** Thickness of the ring of the effect: it grows with the picture, so a small avatar does not look heavy. */
  protected readonly ringPx = computed(
    function (this: AvatarComponent) {
      return Math.max(4, Math.round(this.size() * this.ringRatio() * 10) / 10);
    }.bind(this),
  );
  /** How far the dot of the state is from the corner: its center sits on the edge of the picture (or of the ring). */
  protected readonly dotOffset = computed(
    function (this: AvatarComponent) {
      if (this.shape() === 'square') {
        return -2;
      }
      const radius = this.size() / 2;
      const ring = this.auraClass() ? this.ringPx() : 0;
      const centre = radius + 0.7071 * (radius + ring);
      return Math.round((this.size() - centre - this.dot() / 2) * 10) / 10;
    }.bind(this),
  );
  protected readonly dot = computed(
    function (this: AvatarComponent) {
      return Math.max(9, this.size() * 0.25);
    }.bind(this),
  );

  protected readonly initials = computed(
    function (this: AvatarComponent) {
      const name = (this.name() ?? this.user()?.displayName ?? this.user()?.username ?? '?').trim();
      const parts = name.split(/\s+/).filter(Boolean);
      return (
        (parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1]![0]! : '')
      ).toUpperCase();
    }.bind(this),
  );
  protected readonly background = computed(
    function (this: AvatarComponent) {
      const color = this.color() ?? this.user()?.avatarColor ?? '#2ef2b0';
      return `linear-gradient(135deg, ${color}, color-mix(in oklab, ${color} 55%, #8b5cf6))`;
    }.bind(this),
  );
  protected readonly statusColor = computed(
    function (this: AvatarComponent) {
      return STATUS_COLORS[this.status() ?? 'offline'];
    }.bind(this),
  );

  /** Opens the picture big (when it is asked and there is a picture). */
  protected zoom(event: Event): void {
    const url = this.src();
    if (this.zoomable() && url) {
      event.stopPropagation();
      this.viewer.show(url, this.user()?.displayName ?? this.name() ?? '');
    }
  }

  constructor() {
    // The picture moves when the pointer is over it or over the row it belongs to (a person in a list, a message), not only over
    // the few pixels of the picture itself.
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const enter = this.hover.set.bind(this.hover, true);
    const leave = this.hover.set.bind(this.hover, false);
    const row = host.closest<HTMLElement>('button, a, li, [role="button"], [role="menuitem"]') ?? host;
    row.addEventListener('pointerenter', enter);
    row.addEventListener('pointerleave', leave);
    if (row !== host) {
      host.addEventListener('pointerenter', enter);
    }
    inject(DestroyRef).onDestroy(function release() {
      row.removeEventListener('pointerenter', enter);
      row.removeEventListener('pointerleave', leave);
      host.removeEventListener('pointerenter', enter);
    });
    effect(
      function (this: AvatarComponent) {
        const id = this.resolvedImage();
        untracked(
          function (this: AvatarComponent) {
            return this.images.ensure(id, this.imageId() == null);
          }.bind(this),
        );
      }.bind(this),
    );
  }
}
