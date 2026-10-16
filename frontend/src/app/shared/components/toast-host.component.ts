/**
 * src/app/shared/components/toast-host.component.ts
 * Container of the notices and of the confirmation and text dialogs.
 */
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../../core/services/toast.service';
import { DialogService } from '../../core/services/dialog.service';
import { TranslatePipe } from '../../core/i18n/i18n.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-toast-host',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <div
      class="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-1.5"
    >
      @for (t of toasts.toasts(); track t.id) {
        <div
          class="anim-slide-right pointer-events-auto flex cursor-pointer items-center gap-2.5 rounded-ui border border-white/10 bg-ink-800 px-3 py-2 shadow-xl"
          [class.border-red-500/40]="t.kind === 'error'"
          (click)="t.action?.(); toasts.dismiss(t.id)"
          role="status"
        >
          <span class="text-base leading-none">{{ t.icon }}</span>
          <div class="min-w-0 flex-1">
            <div class="truncate text-[0.8125rem] font-semibold">{{ t.title | t }}</div>
            @if (t.body) {
              <div class="line-clamp-1 text-[0.6875rem] text-muted">{{ t.body | t }}</div>
            }
          </div>
        </div>
      }
    </div>

    @if (dialog.promptRequest(); as q) {
      <div
        class="anim-fade-in fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4"
      >
        <form
          class="panel anim-pop w-full max-w-sm p-6"
          (submit)="$event.preventDefault(); q.resolve(campo.value)"
        >
          <h3 class="text-lg font-bold">{{ q.title | t }}</h3>
          <p class="mt-2 text-sm text-muted">{{ q.message | t }}</p>
          <input
            #campo
            class="input mt-4"
            maxlength="32"
            [value]="q.value"
            [placeholder]="q.placeholder | t"
            autofocus
          />
          <div class="mt-6 flex justify-end gap-2">
            <button class="btn" type="button" (click)="q.resolve(null)">{{ 'Cancel' | t }}</button>
            <button class="btn btn-primary" type="submit">{{ 'Save' | t }}</button>
          </div>
        </form>
      </div>
    }

    @if (dialog.confirmRequest(); as d) {
      <div
        class="anim-fade-in fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      >
        <div class="panel anim-pop w-full max-w-sm p-6">
          <h3 class="text-lg font-bold">{{ d.title | t }}</h3>
          <p class="mt-2 text-sm text-muted">{{ d.message | t }}</p>
          <div class="mt-6 flex justify-end gap-2">
            <button class="btn" type="button" (click)="d.resolve(false)">{{ 'Cancel' | t }}</button>
            <button
              class="btn"
              [class.btn-danger]="d.danger"
              [class.btn-primary]="!d.danger"
              type="button"
              (click)="d.resolve(true)"
            >
              {{ d.confirmLabel | t }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class ToastHostComponent {
  protected readonly toasts = inject(ToastService);
  protected readonly dialog = inject(DialogService);
}
