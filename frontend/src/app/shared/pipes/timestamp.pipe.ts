/**
 * src/app/shared/pipes/timestamp.pipe.ts
 * Formatting of times, dates, file sizes and durations for the chat: the `timestamp` pipe, the 12 h / 24 h
 * preference and the small helpers that turn bytes and milliseconds into text.
 */
import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';

/** The time format the person chose in Settings ('auto' follows the language of the browser). */
export type TimeFormat = 'auto' | '12' | '24';

/** Current preference; SettingsService keeps it up to date. */
let timeFormat: TimeFormat = 'auto';

/** Sets the time format used by every timestamp. */
export function setTimeFormat(format: TimeFormat): void {
  timeFormat = format;
}

/** True when two dates fall on the same calendar day. */
function isSameDay(first: Date, second: Date): boolean {
  return first.toDateString() === second.toDateString();
}

/** Two digits, with a leading zero when needed. */
function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** The clock time of a date: "14:05", or "2:05 PM" in 12 hour mode (the AM/PM mark always comes after it). */
function formatTime(date: Date): string {
  if (timeFormat === '12') {
    const hour = date.getHours();
    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    return hour12 + ':' + twoDigits(date.getMinutes()) + ' ' + (hour < 12 ? 'AM' : 'PM');
  }
  if (timeFormat === '24') {
    return twoDigits(date.getHours()) + ':' + twoDigits(date.getMinutes());
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Text for a moment in time: the time today, "Yesterday 14:05" yesterday, and the date (with the time) before.
 * @param value The moment to show.
 * @param yesterdayLabel Word for "yesterday" in the current language.
 * @param now Current moment (can be replaced in tests).
 */
function formatTimestamp(
  value: number | string | Date,
  yesterdayLabel = 'Yesterday',
  now = new Date(),
): string {
  const date = new Date(value);
  const time = formatTime(date);
  if (isSameDay(date, now)) {
    return time;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) {
    return yesterdayLabel + ' ' + time;
  }
  const days = (now.getTime() - date.getTime()) / 86_400_000;
  const day =
    days < 180
      ? date.toLocaleDateString([], { month: 'short', day: 'numeric' })
      : date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  return day + ', ' + time;
}

/** `{{ date | timestamp }}`: "14:02" today, "Yesterday 14:02", "Oct 24, 14:02"... Re-evaluated when the format changes. */
@Pipe({ name: 'timestamp', standalone: true, pure: false })
export class TimestampPipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  /** Formats a moment; empty text for no value. */
  transform(value: number | string | Date | null | undefined): string {
    return value === null || value === undefined
      ? ''
      : formatTimestamp(value, this.i18n.t('Yesterday'));
  }
}

/** File size as text: "512 B", "40 KB", "3.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return bytes + ' B';
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(0) + ' KB';
  }
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

/** Duration in milliseconds as "m:ss". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return Math.floor(seconds / 60) + ':' + twoDigits(seconds % 60);
}
