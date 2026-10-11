/**
 * src/app/core/services/cursor-styles.ts
 * How each family of cursors draws things. A cursor state (text, hand, zoom...) is described once, as lines and
 * closed shapes; every family paints those lines and shapes in its own way (a tube of neon light, a solid color with a
 * dark edge, a glossy gradient, a black arrow with a white edge...). That way every family has every state.
 * The drawings are SVG text with {a} for the accent, {d} for dark and {r} for red.
 */

/** Outline of the arrow shared by the arrow families. */
export const ARROW = 'M6 3.5v21l5.6-5 3.4 8 3.2-1.4-3.4-7.8H22z';
/** The point every arrow-like cursor points with: the tip of the arrow and the tip of the finger of the hand are drawn here. */
export const TIP: [number, number] = [10, 4];
/** A dart, like a paper plane (the tip is at 5, 4). */
const DART = 'M5 4 27 14 16.5 16.5 13 27z';
/** A solid right triangle, like a folded corner (the tip is at 4, 4). */
const TRIANGLE = 'M4 4 22 10 10 22z';
/** A drop with the tip up and to the left (the tip is at 4, 4). */
const DROP = 'M4 4 12 6.5a7.5 7.5 0 1 1-5.5 5.5z';
/** A ring on a short stick (the end of the stick is at 4.5, 4.5). */
const RING = 'M4.5 4.5l5.2 5.4M14 9a6.5 6.5 0 1 0 .01 0z';
/** The arrow of each family, where its tip is, and the part of it that can be filled (the drop, the ring). */
const ARROWS: Record<string, { d: string; tip: [number, number]; fill?: string }> = {
  classic: { d: ARROW, tip: [6, 3] },
  themed: { d: DART, tip: [5, 4] },
  solid: { d: TRIANGLE, tip: [4, 4] },
  soft: { d: DROP, tip: [4, 4] },
  sleek: { d: RING, tip: [4.5, 4.5], fill: '<circle cx="14" cy="15.5" r="6.5"/>' },
};
/** Outline of the hand of the link cursor. */
const HAND =
  'M12 4a2 2 0 0 1 2 2v7h1v-2a2 2 0 0 1 4 0v2h1a2 2 0 0 1 4 0v6c0 4-3 7-7 7h-3c-3 0-5-2-6-4l-3-5a2 2 0 0 1 3-2l2 2V6a2 2 0 0 1 2-2z';

/** What a family does to paint. */
interface Painter {
  /** The color of a plain shape (the arrow, the hand). */
  base: string;
  /** A line drawing in a color. */
  line(path: string, color: string): string;
  /** Closed shapes (each one is the text of an SVG element ending before its attributes) painted in a color. */
  shape(elements: string[], color: string, thin?: boolean): string;
  /** The color of a mark drawn over a filled shape (the "?" of the help cursor). */
  mark: string;
}

/** The shapes of a state of a cursor, which every painter turns into a drawing. */
interface Geometry {
  lines: { d: string; red?: boolean }[];
  shapes: string[];
  /** Marks drawn over the shapes. */
  marks: string[];
}

/** Adds the attributes to every element. */
function dress(elements: string[], attrs: string): string {
  return elements
    .map(function put(element) {
      return element.replace(/\/>$/, ' ' + attrs + '/>');
    })
    .join('');
}

/** A tube of light: layers of glow around a bright core, dark inside. */
const neon: Painter = {
  base: '{a}',
  mark: '{a}',
  line(path, color) {
    const common = 'd="' + path + '" fill="none" stroke-linecap="round" stroke-linejoin="round"';
    return (
      '<path ' +
      common +
      ' stroke="' +
      color +
      '" stroke-opacity=".12" stroke-width="10"/>' +
      '<path ' +
      common +
      ' stroke="' +
      color +
      '" stroke-opacity=".25" stroke-width="6.5"/>' +
      '<path ' +
      common +
      ' stroke="' +
      color +
      '" stroke-width="2.6"/>' +
      '<path ' +
      common +
      ' stroke="#fff" stroke-opacity=".85" stroke-width="1"/>'
    );
  },
  shape(elements, color) {
    return (
      dress(
        elements,
        'fill="none" stroke="' +
          color +
          '" stroke-opacity=".12" stroke-width="10" stroke-linejoin="round"',
      ) +
      dress(
        elements,
        'fill="none" stroke="' +
          color +
          '" stroke-opacity=".25" stroke-width="6.5" stroke-linejoin="round"',
      ) +
      dress(
        elements,
        'fill="{d}" fill-opacity=".78" stroke="' +
          color +
          '" stroke-width="2.6" stroke-linejoin="round"',
      ) +
      dress(
        elements,
        'fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="1" stroke-linejoin="round"',
      )
    );
  },
};

/** The plain color with a dark edge. */
const solid: Painter = {
  base: '{a}',
  mark: '{d}',
  line(path, color) {
    const common = 'd="' + path + '" fill="none" stroke-linecap="round" stroke-linejoin="round"';
    return (
      '<path ' +
      common +
      ' stroke="{d}" stroke-width="5"/><path ' +
      common +
      ' stroke="' +
      color +
      '" stroke-width="2.4"/>'
    );
  },
  shape(elements, color) {
    return dress(
      elements,
      'fill="' + color + '" stroke="{d}" stroke-width="1.6" stroke-linejoin="round"',
    );
  },
};

/** Chubby and friendly: thick rounded strokes with a little shine. */
const soft: Painter = {
  base: '{a}',
  mark: '{d}',
  line(path, color) {
    const common = 'd="' + path + '" fill="none" stroke-linecap="round" stroke-linejoin="round"';
    return (
      '<path ' +
      common +
      ' stroke="{d}" stroke-width="6.6"/><path ' +
      common +
      ' stroke="' +
      color +
      '" stroke-width="3.6"/>' +
      '<path ' +
      common +
      ' stroke="#fff" stroke-opacity=".35" stroke-width="1.2" transform="translate(-.4 -.4)"/>'
    );
  },
  // The hand has thin fingers: with the thick outline of the arrow they would fuse into one blob, so it gets a thinner one.
  shape(elements, color, thin) {
    const edge = thin ? '2.6' : '5.4';
    const fill = thin ? '1' : '2.8';
    return (
      dress(
        elements,
        'fill="{d}" stroke="{d}" stroke-width="' + edge + '" stroke-linejoin="round"',
      ) +
      dress(
        elements,
        'fill="' +
          color +
          '" stroke="' +
          color +
          '" stroke-width="' +
          fill +
          '" stroke-linejoin="round"',
      )
    );
  },
};

/** Glossy: white that turns into the color, a thin dark edge and a soft shadow. */
const sleek: Painter = {
  base: '{a}',
  mark: '{d}',
  line(path, color) {
    const common = 'd="' + path + '" fill="none" stroke-linecap="round" stroke-linejoin="round"';
    return (
      '<defs><linearGradient id="sg" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="' +
      color +
      '"/></linearGradient></defs>' +
      '<path ' +
      common +
      ' stroke="{d}" stroke-opacity=".35" stroke-width="3" transform="translate(1 1.6)"/>' +
      '<path ' +
      common +
      ' stroke="{d}" stroke-width="4.4"/><path ' +
      common +
      ' stroke="url(#sg)" stroke-width="2.4"/>'
    );
  },
  shape(elements, color) {
    return (
      '<defs><linearGradient id="sg" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="' +
      color +
      '"/></linearGradient></defs>' +
      dress(elements, 'fill="{d}" fill-opacity=".35" transform="translate(1 1.8)"') +
      dress(elements, 'fill="url(#sg)" stroke="{d}" stroke-width="1.4" stroke-linejoin="round"')
    );
  },
};

/** A soft glow around a core of color. */
const halo: Painter = {
  base: '{a}',
  mark: '{a}',
  line(path, color) {
    const common = 'd="' + path + '" fill="none" stroke-linecap="round" stroke-linejoin="round"';
    return (
      '<path ' +
      common +
      ' stroke="' +
      color +
      '" stroke-opacity=".22" stroke-width="9"/>' +
      '<path ' +
      common +
      ' stroke="' +
      color +
      '" stroke-width="2.6"/><path ' +
      common +
      ' stroke="#fff" stroke-opacity=".55" stroke-width="1"/>'
    );
  },
  shape(elements, color) {
    return (
      dress(
        elements,
        'fill="' +
          color +
          '" fill-opacity=".22" stroke="' +
          color +
          '" stroke-width="2.2" stroke-linejoin="round"',
      ) + dress(elements, 'fill="none" stroke="#fff" stroke-opacity=".4" stroke-width="1"')
    );
  },
};

/** Blocky, like an old game: square ends and no smoothing. */
const pixel: Painter = {
  base: '{a}',
  mark: '{d}',
  line(path, color) {
    const common =
      'd="' +
      path +
      '" fill="none" stroke-linecap="square" stroke-linejoin="miter" shape-rendering="crispEdges"';
    return (
      '<path ' +
      common +
      ' stroke="{d}" stroke-width="5"/><path ' +
      common +
      ' stroke="' +
      color +
      '" stroke-width="2"/>'
    );
  },
  shape(elements, color) {
    return dress(
      elements,
      'fill="' +
        color +
        '" stroke="{d}" stroke-width="2" stroke-linejoin="miter" shape-rendering="crispEdges"',
    );
  },
};

/** The cursor everybody knows: black with a clean white edge. */
const classic: Painter = {
  base: '#14161c',
  mark: '#fff',
  line(path, color) {
    const common = 'd="' + path + '" fill="none" stroke-linecap="round" stroke-linejoin="round"';
    if (color === '#fff') {
      return '<path ' + common + ' stroke="#fff" stroke-width="2.2"/>';
    }
    return (
      '<path ' +
      common +
      ' stroke="#fff" stroke-width="5"/><path ' +
      common +
      ' stroke="' +
      (color === '{r}' ? '{r}' : '#14161c') +
      '" stroke-width="2.2"/>'
    );
  },
  shape(elements, color) {
    return (
      dress(elements, 'fill="{d}" fill-opacity=".28" transform="translate(1 1.6)"') +
      dress(
        elements,
        'fill="' +
          color +
          '" stroke="#fff" stroke-width="2" stroke-linejoin="round" paint-order="stroke"',
      )
    );
  },
};

/** The painter of each family. */
const PAINTERS: Record<string, Painter> = {
  themed: neon,
  solid,
  soft,
  sleek,
  halo,
  pixel,
  classic,
};

/** What each cursor state is made of. */
const GEOMETRY: Record<string, Geometry> = {
  default: { lines: [], shapes: ['<path d="' + ARROW + '"/>'], marks: [] },
  pointer: { lines: [], shapes: ['<path d="' + HAND + '"/>'], marks: [] },
  text: { lines: [{ d: 'M12 5h8M12 27h8M16 5v22' }], shapes: [], marks: [] },
  grab: {
    lines: [],
    shapes: [
      '<rect x="7" y="11" width="4" height="10" rx="2"/>',
      '<rect x="12" y="8" width="4" height="13" rx="2"/>',
      '<rect x="17" y="9" width="4" height="12" rx="2"/>',
      '<rect x="22" y="12" width="4" height="9" rx="2"/>',
      '<rect x="7" y="16" width="19" height="11" rx="5"/>',
    ],
    marks: [],
  },
  grabbing: {
    lines: [],
    shapes: [
      '<rect x="8" y="14" width="4" height="7" rx="2"/>',
      '<rect x="12.5" y="13" width="4" height="8" rx="2"/>',
      '<rect x="17" y="13.5" width="4" height="7.5" rx="2"/>',
      '<rect x="21.5" y="15" width="3.5" height="6" rx="1.75"/>',
      '<rect x="7" y="17" width="19" height="10" rx="5"/>',
    ],
    marks: [],
  },
  forbidden: {
    lines: [{ d: 'M16 6a10 10 0 1 0 .01 0zM9 23 23 9', red: true }],
    shapes: [],
    marks: [],
  },
  wait: { lines: [{ d: 'M16 7a9 9 0 1 1-6.4 2.6' }], shapes: [], marks: [] },
  help: {
    lines: [],
    shapes: ['<circle cx="16" cy="16" r="11"/>'],
    marks: ['M12.6 12.6a3.5 3.5 0 1 1 5 3.2c-1.1.6-1.6 1.2-1.6 2.4M16 22.3v.1'],
  },
  zoom: {
    lines: [{ d: 'M14 6a8 8 0 1 0 .01 0zM20 20l7 7M10.5 14h7M14 10.5v7' }],
    shapes: [],
    marks: [],
  },
  move: {
    lines: [{ d: 'M16 5v22M5 16h22M12 9l4-4 4 4M12 23l4 4 4-4M9 12l-4 4 4 4M23 12l4 4-4 4' }],
    shapes: [],
    marks: [],
  },
  'resize-h': { lines: [{ d: 'M4 16h24M9 11l-5 5 5 5M23 11l5 5-5 5' }], shapes: [], marks: [] },
  'resize-v': { lines: [{ d: 'M16 4v24M11 9l5-5 5 5M11 23l5 5 5-5' }], shapes: [], marks: [] },
  crosshair: { lines: [{ d: 'M16 5v8M16 19v8M5 16h8M19 16h8' }], shapes: [], marks: [] },
};

/** The drawing of a cursor state in a family. */
export function stateSvg(family: string, name: string): string {
  const painter = PAINTERS[family] ?? neon;
  const geometry = GEOMETRY[name] ?? GEOMETRY['default']!;
  let out = '';
  if (geometry.shapes.length) {
    out += painter.shape(geometry.shapes, painter.base, name === 'pointer');
  }
  for (const mark of geometry.marks) {
    out += painter.line(mark, painter.mark);
  }
  for (const line of geometry.lines) {
    out += painter.line(line.d, line.red ? '{r}' : '{a}');
  }
  return out;
}

/** Where the arrow of a family points: the same place for the arrow and for the hand, so the pointer never seems to jump. */
export function arrowHot(family: string): [number, number] | null {
  return ARROWS[family] ? TIP : null;
}

/** Moves a drawing so that a point of it lands on the tip of the cursor. */
function placed(svg: string, from: [number, number]): string {
  return (
    '<g transform="translate(' +
    (TIP[0] - from[0]) +
    ' ' +
    (TIP[1] - from[1]) +
    ')">' +
    svg +
    '</g>'
  );
}

/** The arrow of a family; over something that can be pressed it becomes a hand in the same style, with a halo. */
export function arrowSvg(family: string, hover: boolean): string {
  const info = ARROWS[family] ?? ARROWS['classic']!;
  const painter = PAINTERS[family] ?? neon;
  const path = hover ? HAND : info.d;
  const from: [number, number] = hover ? [12, 4] : info.tip;
  const shape = ['<path d="' + path + '"/>'];
  const halo = hover
    ? '<path d="' +
      path +
      '" fill="none" stroke="{a}" stroke-opacity=".4" stroke-width="' +
      (family === 'soft' ? '4.5' : '9') +
      '" stroke-linejoin="round"/>'
    : '';
  let body: string;
  if (family === 'sleek') {
    // Elegant: only an outline, filled a little when the hand shows.
    const fill = hover ? shape : info.fill ? [info.fill] : [];
    body =
      halo +
      dress(fill, hover ? 'fill="{a}" fill-opacity=".5"' : 'fill="#fff" fill-opacity=".12"') +
      painter.line(path, '{a}');
  } else {
    body = halo + painter.shape(shape, painter.base, hover);
    if (hover && family === 'themed') {
      body += dress(shape, 'fill="{a}" fill-opacity=".45"');
    }
  }
  return placed(body, from);
}
