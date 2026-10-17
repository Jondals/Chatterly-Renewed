/**
 * src/app/features/settings/permissions-section.component.ts
 * Settings - Permissions (the Android app): what Chatterly needs from the phone, whether each thing is allowed now, and a button to
 * allow it. When Android no longer shows its question (it was refused for good) the button opens the page of Android about the app.
 */
import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/i18n.service';
import { NativeCallService } from '../../core/services/native-call.service';
import { IconComponent } from '../../shared/components/icon.component';

/** One thing the app may need from the phone. */
interface PermissionRow {
  id: 'microphone' | 'camera' | 'notifications' | 'lockscreen' | 'battery';
  icon: string;
  title: string;
  hint: string;
}

/** The screen of permissions. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-permissions-section',
  standalone: true,
  imports: [IconComponent, TranslatePipe],
  template: `
    <p class="mb-4 text-sm text-muted">
      {{
        'These are the permissions Chatterly asks of this phone. Allow the ones you want to use: nothing is used without them.'
          | t
      }}
    </p>
    <ul class="space-y-2">
      @for (row of rows; track row.id) {
        <li
          class="flex flex-wrap items-center gap-3 rounded-ui-lg border border-white/8 bg-black/15 px-4 py-3"
        >
          <span class="menu-icon !h-9 !w-9 bg-white/5 text-muted"
            ><app-icon [name]="row.icon" [size]="16"
          /></span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">{{ row.title | t }}</span>
            <span class="block text-xs text-muted">{{ row.hint | t }}</span>
          </span>
          @if (allowed(row.id)) {
            <span class="chip chip-accent"><app-icon name="check" [size]="12" /> {{ 'Allowed' | t }}</span>
          } @else {
            <button type="button" class="btn btn-sm btn-primary" (click)="allow(row.id)">
              {{ 'Allow' | t }}
            </button>
          }
        </li>
      }
    </ul>
    <div class="mt-5 flex items-center justify-between gap-3">
      <span class="text-xs text-dim">{{
        'Sharing the screen is asked by Android every time you start it.' | t
      }}</span>
      <button type="button" class="btn btn-sm" (click)="native.openAppSettings()">
        <app-icon name="settings" [size]="13" /> {{ 'Open the settings of the app' | t }}
      </button>
    </div>
  `,
})
export class PermissionsSectionComponent implements OnInit {
  protected readonly native = inject(NativeCallService);
  protected readonly rows: PermissionRow[] = [
    {
      id: 'microphone',
      icon: 'mic',
      title: 'Microphone',
      hint: 'To talk in calls and record voice notes.',
    },
    { id: 'camera', icon: 'video', title: 'Camera', hint: 'To turn your camera on in a call.' },
    {
      id: 'notifications',
      icon: 'bell',
      title: 'Notifications',
      hint: 'Messages, the call in progress and calls that ring.',
    },
    {
      id: 'lockscreen',
      icon: 'phone',
      title: 'Calls over the lock screen',
      hint: 'So a call that rings fills the screen even with the phone locked.',
    },
    {
      id: 'battery',
      icon: 'activity',
      title: 'Keep calls when you clear the recent apps',
      hint: 'Run without battery limits: on some phones clearing the recent apps ends the call.',
    },
  ];

  /** Reads what is allowed now (it is read again when the person comes back from the settings of Android). */
  ngOnInit(): void {
    void this.native.checkPermissions();
  }

  /** Whether a permission is allowed now. */
  protected allowed(id: PermissionRow['id']): boolean {
    switch (id) {
      case 'lockscreen':
        return this.native.fullScreenAllowed();
      case 'battery':
        return this.native.batteryUnrestricted();
      default:
        return this.native.permissions()[id];
    }
  }

  /** The button of a row: Android asks, or its page opens where the thing is allowed. */
  protected allow(id: PermissionRow['id']): void {
    if (id === 'lockscreen') this.native.openFullScreenSettings();
    else if (id === 'battery') this.native.openBatterySettings();
    else void this.native.askPermission(id);
  }
}
