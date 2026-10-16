/**
 * src/app/features/chat/status-mark.component.ts
 * A tiny dot next to the time of your messages: an empty ring when sent, a green dot when delivered and a blue
 * dot when read. It says nothing unless you hover it (then the tooltip names the state), so it never distracts.
 */
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import type { MessageStatus } from '../../core/services/receipt.service';

/** Sent, delivered or read dot of a message. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-status-mark',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <span
      class="status-dot"
      [class]="'status-' + status()"
      role="img"
      [attr.title]="label() | t"
      [attr.aria-label]="label() | t"
    ></span>
  `,
  host: { class: 'inline-flex items-center' },
})
export class StatusMarkComponent {
  /** What to show. */
  readonly status = input.required<MessageStatus>();

  /** The word for the tooltip and screen readers. */
  protected readonly label = computed(this.pickLabel.bind(this));

  /** The word for the current status. */
  private pickLabel(): string {
    const status = this.status();
    if (status === 'read') {
      return 'Read';
    }
    return status === 'delivered' ? 'Delivered, not read yet' : 'Sent';
  }
}
