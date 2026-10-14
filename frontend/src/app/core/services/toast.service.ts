/**
 * src/app/core/services/toast.service.ts
 * Small pop-up notices (success, error, information, new message, call). They respect the person's setting:
 * show all, show only the important ones (errors and calls) or show none.
 */
import { Injectable, inject, signal } from '@angular/core';
import { SettingsService } from './settings.service';

type ToastKind = 'info' | 'success' | 'error' | 'message' | 'call';

/** One notice on screen. */
export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
  icon?: string;
  /** Optional click handler, for example to open the conversation. */
  action?: () => void;
}

/** Most notices kept on screen at the same time. */
const MAX_TOASTS = 5;

/** The notices that are on screen. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private nextId = 1;
  private readonly settings = inject(SettingsService);

  /**
   * Shows a short notice and removes it after `ms` milliseconds (0 keeps it until it is dismissed).
   * Returns its id, or -1 when the person's setting hides this kind of notice.
   */
  show(toast: Omit<Toast, 'id'>, ms = 2200): number {
    const mode = this.settings.toastMode();
    if (
      mode === 'off' ||
      (mode === 'important' && toast.kind !== 'error' && toast.kind !== 'call')
    ) {
      return -1;
    }
    const id = this.nextId++;
    this.toasts.update(function addToast(list: Toast[]) {
      return [...list.slice(1 - MAX_TOASTS), { ...toast, id }];
    });
    if (ms > 0) {
      setTimeout(this.dismiss.bind(this, id), ms);
    }
    return id;
  }

  /** Shows a success notice. */
  success(title: string, body?: string): number {
    return this.show({ kind: 'success', title, body, icon: '✅' });
  }

  /** Shows an error notice (it stays a little longer). */
  error(title: string, body?: string): number {
    return this.show({ kind: 'error', title, body, icon: '⚠️' }, 4000);
  }

  /** Shows an information notice. */
  info(title: string, body?: string, icon = '💬'): number {
    return this.show({ kind: 'info', title, body, icon });
  }

  /** Removes a notice. */
  dismiss(id: number): void {
    this.toasts.update(function removeToast(list: Toast[]) {
      return list.filter(function isOther(toast: Toast) {
        return toast.id !== id;
      });
    });
  }
}
