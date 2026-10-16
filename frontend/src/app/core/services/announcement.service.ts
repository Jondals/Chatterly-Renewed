/**
 * src/app/core/services/announcement.service.ts
 * The announcement of the server: a short text the administrators put for everybody (a maintenance, a new version). It is
 * read when the person signs in and arrives live (`server.announcement` on the socket); each person can hide it, and it
 * stays hidden on that device until there is a new one.
 * ! It is plain text: it is drawn as text, never as markup.
 */
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { persisted } from './persisted';
import { SocketService, type ServerEvent } from './socket.service';

/** The announcement, as the server gives it. */
export interface Announcement {
  id: string;
  text: string;
  tone: 'info' | 'warning';
  at: number;
}

@Injectable({ providedIn: 'root' })
export class AnnouncementService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly socket = inject(SocketService);

  /** The announcement in force (null when there is none). */
  readonly current = signal<Announcement | null>(null);
  /** The one the person hid on this device. */
  private readonly hidden = persisted<string>('announcement.hidden', '');
  /** What the bar on top shows. */
  readonly visible = computed(this.readVisible.bind(this));

  constructor() {
    effect(this.follow.bind(this));
    this.socket.events$.subscribe(this.onEvent.bind(this));
  }

  /** Hides the announcement on this device (until there is a new one). */
  hide(): void {
    const now = this.current();
    if (now) this.hidden.set(now.id);
  }

  private readVisible(): Announcement | null {
    const now = this.current();
    return now && now.id !== this.hidden() ? now : null;
  }

  /** Reads it when somebody signs in, forgets it when they sign out. */
  private follow(): void {
    if (this.auth.isAuthenticated()) {
      untracked(this.load.bind(this));
    } else {
      this.current.set(null);
    }
  }

  private load(): void {
    this.api
      .get<{ announcement: Announcement | null }>('/api/announcement')
      .then(this.onAnswer.bind(this), function olderServer(): void {
        // A server without announcements: nothing to show.
      });
  }

  private onAnswer(answer: { announcement: Announcement | null }): void {
    this.current.set(this.clean(answer.announcement));
  }

  /** A new announcement (or none) arrived live. */
  private onEvent(event: ServerEvent): void {
    if (event.t === 'server.announcement') {
      const e = event as unknown as { announcement: Announcement | null };
      this.current.set(this.clean(e.announcement));
    }
  }

  /** Keeps only well-formed values. */
  private clean(raw: Announcement | null | undefined): Announcement | null {
    if (!raw || typeof raw.text !== 'string' || raw.text.trim() === '') return null;
    return {
      id: String(raw.id).slice(0, 40),
      text: raw.text.slice(0, 300),
      tone: raw.tone === 'warning' ? 'warning' : 'info',
      at: Number(raw.at) || 0,
    };
  }
}
