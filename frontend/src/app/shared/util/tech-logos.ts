/**
 * src/app/shared/util/tech-logos.ts
 * Simple SVG logos (24 x 24) of the technologies the app is made with, for the About section.
 */

/** Name and SVG drawing of each technology. They are constants of this app: no user input ever reaches them. */
export type TechPlatform = 'web' | 'desktop' | 'android';

/** A technology; without `platforms` it is shown on every platform (the page and the server are the same everywhere). */
export interface Technology {
  name: string;
  url: string;
  svg: string;
  platforms?: TechPlatform[];
}

export const TECHNOLOGIES: Technology[] = [
  {
    name: 'Angular 21',
    url: 'https://angular.dev',
    svg: '<path d="M12 2 3 5.5l1.4 12L12 22l7.6-4.5L21 5.5z" fill="#dd0031"/><path d="M12 2v20l7.6-4.5L21 5.5z" fill="#c3002f"/><path d="M12 5.6 7 16.6h1.9l1-2.5h4.2l1 2.5H17zm0 3.6 1.4 3.4h-2.8z" fill="#fff"/>',
  },
  {
    name: 'Tailwind 4',
    url: 'https://tailwindcss.com',
    svg: '<path d="M12 6c-2.7 0-4.4 1.3-5 4 1-1.3 2.2-1.8 3.5-1.5.8.2 1.3.7 1.9 1.3 1 1 2.1 2.2 4.6 2.2 2.7 0 4.4-1.3 5-4-1 1.3-2.2 1.8-3.5 1.5-.8-.2-1.3-.7-1.9-1.3C15.6 7.2 14.5 6 12 6zM7 12c-2.7 0-4.4 1.3-5 4 1-1.3 2.2-1.8 3.5-1.5.8.2 1.3.7 1.9 1.3 1 1 2.1 2.2 4.6 2.2 2.7 0 4.4-1.3 5-4-1 1.3-2.2 1.8-3.5 1.5-.8-.2-1.3-.7-1.9-1.3C10.6 13.2 9.5 12 7 12z" fill="#38bdf8"/>',
  },
  {
    name: 'WebCrypto',
    url: 'https://developer.mozilla.org/docs/Web/API/Web_Crypto_API',
    svg: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5" fill="#22c55e"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="#22c55e" stroke-width="2"/><circle cx="12" cy="15.5" r="1.8" fill="#06210f"/>',
  },
  {
    name: 'WebRTC',
    url: 'https://webrtc.org',
    svg: '<circle cx="12" cy="12" r="9" fill="none" stroke="#f59e0b" stroke-width="2"/><path d="M7 12a5 5 0 0 1 10 0" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/><path d="M9.5 15a2.5 2.5 0 0 0 5 0" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="1.4" fill="#fff"/>',
  },
  {
    name: 'Electron 44',
    url: 'https://www.electronjs.org',
    platforms: ['desktop'],
    svg: '<circle cx="12" cy="12" r="2" fill="#9feaf9"/><g fill="none" stroke="#47848f" stroke-width="1.6"><ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)"/></g>',
  },
  {
    name: 'Capacitor 8',
    url: 'https://capacitorjs.com',
    platforms: ['android'],
    svg: '<rect x="2" y="2" width="20" height="20" rx="5" fill="#119eff"/><path d="M12 5 6.5 12.5H11L10 19l5.5-7.5H13z" fill="#fff"/>',
  },
  {
    name: 'Android',
    url: 'https://developer.android.com',
    platforms: ['android'],
    svg: '<path d="M6 16.5a6 6 0 0 1 12 0z" fill="#3ddc84"/><path d="M8.5 8.5 7.3 6.5M15.5 8.5l1.2-2" stroke="#3ddc84" stroke-width="1.2" stroke-linecap="round"/><circle cx="9.500" cy="13" r=".8" fill="#0b2b19"/><circle cx="14.500" cy="13" r=".8" fill="#0b2b19"/>',
  },
  {
    name: 'Fastify 5',
    url: 'https://fastify.dev',
    svg: '<rect x="2" y="2" width="20" height="20" rx="5" fill="#e5e7eb"/><path d="M8 6.5h8.5L15.7 9H10.8l-.6 2.2H15l-.7 2.5H9.5L8.5 17.5H6z" fill="#111827"/>',
  },
  {
    name: 'SQLite',
    url: 'https://sqlite.org',
    svg: '<ellipse cx="12" cy="6" rx="7" ry="3" fill="#0f80cc"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6c0 1.7-3.1 3-7 3S5 7.7 5 6z" fill="#0b5f96"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" fill="none" stroke="#7dd3fc" stroke-width="1.2"/>',
  },
  {
    name: 'TypeScript',
    url: 'https://www.typescriptlang.org',
    svg: '<rect x="2" y="2" width="20" height="20" rx="3.5" fill="#3178c6"/><path d="M7 11h6v1.5h-2.2V19H9.2v-6.5H7zM14.5 18.5v-1.7c.5.4 1.2.7 1.9.7s1.1-.3 1.1-.8c0-1.3-3.1-1-3.1-3.2 0-1.2 1-2 2.5-2 .7 0 1.3.1 1.8.4v1.6c-.5-.3-1-.5-1.7-.5-.6 0-.9.2-.9.6 0 1.2 3.1.9 3.1 3.2 0 1.3-1 2.1-2.6 2.1-.8 0-1.5-.2-2.1-.4z" fill="#fff"/>',
  },
];
