/**
 * src/app/core/services/cursor-shapes.ts
 * The drawings of the themed cursors: every cursor state (arrow, link, text, hand...) in several families
 * (Themed, Solid, Soft, Sleek, Halo, Pixel, Classic), drawn as small SVGs in the accent color, the hot spots
 * where each one points, and the helpers that turn them into CSS cursor values or SVG text for the overlay.
 */
import { arrowHot, arrowSvg, stateSvg } from './cursor-styles';
import type { CustomCursor, CursorMode } from './settings.service';

/** Dark color of the outline that keeps every cursor readable on any background. */
const DARK = '#0b0d12';
/** Red used by the "forbidden" cursor. */
const RED = '#f87171';
/** Size of the base drawing of every cursor, in pixels. */
export const BASE_SIZE = 32;

/** One cursor state of one family: SVG template (with {a} for the accent, {d} for dark, {r} for red) and hot spot. */
interface Shape {
  svg: string;
  hot: [number, number];
}

/** Hot spot and fallback cursor of every state (the drawings come from the painters of cursor-styles.ts). */
const BASE: Record<string, { hot: [number, number]; fallback: string }> = {
  default: { hot: [6, 3], fallback: 'auto' },
  pointer: { hot: [16, 16], fallback: 'pointer' },
  text: { hot: [16, 16], fallback: 'text' },
  grab: { hot: [16, 16], fallback: 'grab' },
  grabbing: { hot: [16, 16], fallback: 'grabbing' },
  forbidden: { hot: [16, 16], fallback: 'not-allowed' },
  wait: { hot: [16, 16], fallback: 'wait' },
  help: { hot: [16, 16], fallback: 'help' },
  zoom: { hot: [14, 14], fallback: 'zoom-in' },
  move: { hot: [16, 16], fallback: 'move' },
  'resize-h': { hot: [16, 16], fallback: 'ew-resize' },
  'resize-v': { hot: [16, 16], fallback: 'ns-resize' },
  crosshair: { hot: [16, 16], fallback: 'crosshair' },
};

/** Drawings that are not made by the painters: the arrow and the link of the families with a shape of their own. */
const PRESETS: Record<string, Record<string, Shape>> = {
  halo: {
    default: {
      hot: [16, 16],
      svg: '<circle cx="16" cy="16" r="10" fill="{a}" fill-opacity=".2"/><circle cx="16" cy="16" r="4.4" fill="{a}" stroke="{d}" stroke-width="1.6"/><circle cx="14.6" cy="14.6" r="1.2" fill="#fff" fill-opacity=".8"/>',
    },
    pointer: {
      hot: [16, 16],
      svg: '<circle cx="16" cy="16" r="12" fill="{a}" fill-opacity=".18" stroke="{a}" stroke-width="2"/><circle cx="16" cy="16" r="6" fill="{a}" stroke="{d}" stroke-width="1.6"/><circle cx="14.2" cy="14.2" r="1.6" fill="#fff" fill-opacity=".8"/>',
    },
  },
  pixel: {
    default: {
      hot: [5, 3],
      svg: '<path d="M5 3H7V5H9V7H11V9H13V11H15V13H17V15H19V17H21V19H23V21H16V23H18V29H14V24H5Z" fill="{a}" stroke="{d}" stroke-width="2" stroke-linejoin="miter" shape-rendering="crispEdges"/><path d="M7 8V20" stroke="#fff" stroke-opacity=".5" stroke-width="2" shape-rendering="crispEdges"/>',
    },
    pointer: {
      hot: [16, 16],
      svg: '<rect x="6" y="6" width="20" height="20" fill="{a}" fill-opacity=".25" stroke="{d}" stroke-width="5" shape-rendering="crispEdges"/><rect x="6" y="6" width="20" height="20" fill="none" stroke="{a}" stroke-width="2.4" shape-rendering="crispEdges"/><rect x="13" y="13" width="6" height="6" fill="#fff" shape-rendering="crispEdges"/>',
    },
  },
};

/** The cursor families the person can choose from (the shape of the arrow and of the link cursor). */
export const FAMILIES: string[] = ['classic', 'themed', 'solid', 'soft', 'sleek', 'halo', 'pixel'];

/** Families shaped like an arrow: their trail comes out of the body of the arrow, not from its tip. */
export const ARROW_FAMILIES: string[] = ['themed', 'solid', 'soft', 'sleek', 'pixel', 'classic'];

/** Counter that gives each animated cursor its own filter id (many SVGs live in the page at once). */
let filterCounter = 0;

/** Shape (SVG template and hot spot) of a cursor state in a family. */
function shapeOf(family: string, name: string): Shape {
  const preset = PRESETS[family] ? PRESETS[family][name] : undefined;
  if (preset) {
    return preset;
  }
  // ! The arrow and the link of a family are the same drawing (lit up over a link), so the pointer never seems to jump.
  const hot = arrowHot(family);
  if (hot && (name === 'default' || name === 'pointer')) {
    return { svg: arrowSvg(family, name === 'pointer'), hot };
  }
  return { svg: stateSvg(family, name), hot: BASE[name]!.hot };
}

/** Fills the color placeholders of an SVG template. */
function paint(template: string, accent: string): string {
  return template.split('{a}').join(accent).split('{d}').join(DARK).split('{r}').join(RED);
}

/**
 * Complete SVG of a cursor at the wanted size. When animated, an outline that pulses is added around the
 * whole shape.
 */
export function svgCursor(
  family: string,
  name: string,
  accent: string,
  size: number,
  animated: boolean,
): string {
  let body = paint(shapeOf(family, name).svg, accent);
  if (animated) {
    filterCounter++;
    const id = 'cur' + filterCounter;
    body =
      '<defs><filter id="' +
      id +
      '" x="-40%" y="-40%" width="180%" height="180%">' +
      '<feMorphology in="SourceAlpha" operator="dilate" radius="1" result="d"><animate attributeName="radius" values="0.4;1.3;0.4" dur="1.6s" repeatCount="indefinite"/></feMorphology>' +
      '<feFlood flood-color="' +
      accent +
      '" result="c"><animate attributeName="flood-opacity" values="0.7;0.15;0.7" dur="1.6s" repeatCount="indefinite"/></feFlood>' +
      '<feComposite in="c" in2="d" operator="in" result="o"/><feMerge><feMergeNode in="o"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>' +
      '<g filter="url(#' +
      id +
      ')">' +
      body +
      '</g>';
  }
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    size +
    '" height="' +
    size +
    '" viewBox="0 0 32 32">' +
    body +
    '</svg>'
  );
}

/** Hot spot of a cursor scaled to the chosen size. */
export function hotSpot(family: string, name: string, size: number): [number, number] {
  const hot = shapeOf(family, name).hot;
  return [Math.round((hot[0] * size) / BASE_SIZE), Math.round((hot[1] * size) / BASE_SIZE)];
}

/** Resizes an uploaded picture to the 32 x 32 the browser accepts as a cursor. */
export function cursorImageToDataUrl(file: File): Promise<string> {
  return new Promise(function readImage(resolve, reject) {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = function onLoad() {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 32;
      const scale = Math.min(32 / image.width, 32 / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      canvas.getContext('2d')!.drawImage(image, (32 - width) / 2, (32 - height) / 2, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = function onError() {
      URL.revokeObjectURL(url);
      reject(new Error('unreadable image'));
    };
    image.src = url;
  });
}

/** Value of the CSS `cursor` property for a cursor state (the chosen family, or the themed one for the rest). */
export function cursorCss(
  name: string,
  accent: string,
  mode: CursorMode,
  custom: CustomCursor | null,
  size: number,
): string {
  const base = BASE[name];
  if (custom && (name === 'default' || name === 'pointer') && custom.kind !== 'animated') {
    if (custom.kind === 'cur') {
      return 'url("' + custom.data + '"), ' + base.fallback;
    }
    const x = custom.point === 'corner' ? 0 : Math.round(size / 2);
    const y = custom.point === 'corner' ? 0 : Math.round(size / 2);
    return 'url("' + custom.data + '") ' + x + ' ' + y + ', ' + base.fallback;
  }
  const family = FAMILIES.indexOf(mode) >= 0 ? mode : 'classic';
  const hot = hotSpot(family, name, size);
  return (
    'url("data:image/svg+xml,' +
    encodeURIComponent(svgCursor(family, name, accent, size, false)) +
    '") ' +
    hot[0] +
    ' ' +
    hot[1] +
    ', ' +
    base.fallback
  );
}
