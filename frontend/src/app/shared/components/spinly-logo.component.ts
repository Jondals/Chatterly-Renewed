/**
 * src/app/shared/components/spinly-logo.component.ts
 * The logo of Spinly drawn as SVG inside the page: a ring of four colored parts around a dark hub, with the gem of
 * the pointer on top. Being part of the page it needs no request and shows at once, at any size.
 */
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Counter that gives every logo its own gradient ids (many can live in the page at once). */
let logoCount = 0;

/** Center and radius of the ring (the stroke is as wide as the ring). */
const CX = 64;
const CY = 72;
const RADIUS = 37;

/** A point of the ring at an angle (0 = up, clockwise). */
function pointAt(degrees: number): string {
  const radians = (degrees * Math.PI) / 180;
  return (
    (CX + RADIUS * Math.sin(radians)).toFixed(2) +
    ' ' +
    (CY - RADIUS * Math.cos(radians)).toFixed(2)
  );
}

/** The path of an arc of the ring between two angles. */
function arc(from: number, to: number): string {
  return 'M' + pointAt(from) + ' A' + RADIUS + ' ' + RADIUS + ' 0 0 1 ' + pointAt(to);
}

/** The four parts of the ring, with the gradient each one wears. */
const PARTS = [
  { path: arc(8, 84), fill: 'b' },
  { path: arc(96, 174), fill: 'c' },
  { path: arc(186, 264), fill: 'd' },
  { path: arc(276, 352), fill: 'a' },
];

/** The logo of Spinly. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-spinly-logo',
  standalone: true,
  host: { class: 'inline-block shrink-0 leading-none' },
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 128 128"
      role="img"
      aria-label="Spinly"
    >
      <defs>
        <linearGradient [attr.id]="id + 'a'" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#8b5cf6" />
          <stop offset="1" stop-color="#5b5bf0" />
        </linearGradient>
        <linearGradient [attr.id]="id + 'b'" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ff5d7a" />
          <stop offset="1" stop-color="#e5365f" />
        </linearGradient>
        <linearGradient [attr.id]="id + 'c'" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#e84fb0" />
          <stop offset="1" stop-color="#c026d3" />
        </linearGradient>
        <linearGradient [attr.id]="id + 'd'" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#4f7cf5" />
          <stop offset="1" stop-color="#7c4cf0" />
        </linearGradient>
        <radialGradient [attr.id]="id + 'h'" cx=".35" cy=".3" r=".9">
          <stop offset="0" stop-color="#4a4a8a" />
          <stop offset=".45" stop-color="#1a1a3a" />
          <stop offset="1" stop-color="#0c0c1c" />
        </radialGradient>
        <linearGradient [attr.id]="id + 'g'" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f0589a" />
          <stop offset="1" stop-color="#b92fd0" />
        </linearGradient>
      </defs>
      <g fill="none" stroke-width="27">
        @for (part of parts; track part.fill) {
          <path [attr.d]="part.path" [attr.stroke]="'url(#' + id + part.fill + ')'" />
        }
      </g>
      <circle cx="64" cy="72" r="17.5" [attr.fill]="'url(#' + id + 'h)'" />
      <ellipse
        cx="58"
        cy="65"
        rx="5"
        ry="3.2"
        fill="#fff"
        opacity=".22"
        transform="rotate(-30 58 65)"
      />
      <path
        d="M49 6h30c3.4 0 5.4 3.7 3.6 6.5L68 36a4.6 4.6 0 0 1-8 0L45.4 12.5C43.6 9.7 45.6 6 49 6Z"
        [attr.fill]="'url(#' + id + 'g)'"
        stroke="#fff"
        stroke-opacity=".9"
        stroke-width="3"
        stroke-linejoin="round"
      />
    </svg>
  `,
})
export class SpinlyLogoComponent {
  /** Width and height in pixels. */
  readonly size = input(32);
  /** Prefix of the gradient ids of this logo. */
  protected readonly id = 'spl' + ++logoCount;
  protected readonly parts = PARTS;
}
