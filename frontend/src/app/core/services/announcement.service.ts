/**
 * src/app/core/services/announcement.service.ts
 * The announcement of the server: a short text the administrators put for everybody (a maintenance, a new version). It is
 * read when the person signs in and arrives live (`server.announcement` on the socket); each person can hide it, and it
 * stays hidden on that device (also after signing out) until there is a new one.
 * ! It is plain text: it is drawn as text, never as markup.
 */
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { SoundService } from './sound.service';
import { SocketService, type ServerEvent } from './socket.service';

/** The announcement, as the server gives it. */
export interface Announcement {
  id: string;
  text: string;
  tone: 'info' | 'warning';
  at: number;
}

/** Where the ids of the hidden announcements are kept, and how many. */
const DISMISSED_KEY = 'chatterly.announcement.dismissed';
const DISMISSED_KEEP = 20;

/** The ids of the announcements this device hid. */
function readDismissed(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]');
    return Array.isArray(raw)
      ? raw.filter(function text(id): id is string {
          return typeof id === 'string';
        })
      : [];
  } catch {
    return [];
  }
}

@Injectable({ providedIn: 'root' })
export class AnnouncementService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly socket = inject(SocketService);
  private readonly sound = inject(SoundService);

  /** The announcement in force (null when there is none). */
  readonly current = signal<Announcement | null>(null);
  /**
   * The announcements the person hid on this device (their ids). ! Kept apart from the synced preferences: a copy from the
   * account could bring an old list over this one and the announcement would come back. It survives signing out (it is public).
   */
  private readonly dismissed = signal<string[]>(readDismissed());
  /** What the bar on top shows. */
  readonly visible = computed(this.readVisible.bind(this));

  constructor() {
    effect(this.follow.bind(this));
    this.socket.events$.subscribe(this.onEvent.bind(this));
  }

  /** Hides the announcement on this device (until there is a new one). */
  hide(): void {
    const now = this.current();
    if (!now || this.dismissed().includes(now.id)) return;
    const next = [...this.dismissed(), now.id].slice(-DISMISSED_KEEP);
    this.dismissed.set(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      /* no storage: it stays hidden until the page is loaded again */
    }
  }

  private readVisible(): Announcement | null {
    const now = this.current();
    return now && !this.dismissed().includes(now.id) ? now : null;
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
      const next = this.clean(e.announcement);
      const isNew = next !== null && next.id !== this.current()?.id && !this.dismissed().includes(next.id);
      this.current.set(next);
      // A new announcement of the administrators sounds (adminSound.ogg), like a message does.
      if (isNew) this.sound.play('admin');
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
