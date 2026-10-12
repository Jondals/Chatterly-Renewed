/**
 * ! Tiny markdown subset (plus colour tags) rendered as typed segments — never as HTML — so message
 * content can't inject markup: Angular renders each segment with normal, escaped bindings.
 *
 *   **bold**  _italic_  ~~strike~~  `code`  ```fenced```  https://links
 *   [c=rojo]coloured[/c]   [c=f06]short hex[/c]   [d=ff0066,00ccff]gradient[/d]   [d=rainbow]rainbow[/d]   [d=sunset]by name[/d]
 *   The older forms still work: [c=#ff5577]  [g=#ff0066,#00ccff]...[/g]  [rainbow]...[/rainbow]
 */
export type Segment =
  | { type: 'text'; text: string }
  | { type: 'bold' | 'italic' | 'strike' | 'code'; text: string }
  | { type: 'link'; href: string; text: string }
  | { type: 'codeblock'; lang: string; code: string }
  | { type: 'color'; color: string; children: Segment[] }
  | { type: 'gradient'; colors: string[]; children: Segment[] };

/** Quick gradients offered by both the chat and "About me". */
export const QUICK_GRADIENTS = [
  { name: 'Sunset', colors: ['#ff512f', '#f09819'] },
  { name: 'Ocean', colors: ['#00c6ff', '#7f5af0'] },
  { name: 'Rainbow', colors: ['#ff4d4d', '#ffa63d', '#ffe14d', '#4dff88', '#4dc3ff', '#a066ff'] },
];

export const RAINBOW = ['#ff4d4d', '#ffa63d', '#ffe14d', '#4dff88', '#4dc3ff', '#a066ff'];

/** Gradients that can be written by name: [d=rainbow], [d=sunset], [d=ocean]. */
const NAMED: Record<string, string[]> = {
  rainbow: RAINBOW,
  sunset: QUICK_GRADIENTS[0]!.colors,
  ocean: QUICK_GRADIENTS[1]!.colors,
};

/** Colors that can be written by name, in English and in Spanish: [c=red] or [c=rojo]. The first three are the ones of the chat. */
const NAMED_COLORS: { hex: string; en: string; es: string }[] = [
  { hex: '#ff5d6c', en: 'red', es: 'rojo' },
  { hex: '#4ade80', en: 'green', es: 'verde' },
  { hex: '#38bdf8', en: 'blue', es: 'azul' },
  { hex: '#fde047', en: 'yellow', es: 'amarillo' },
  { hex: '#fb923c', en: 'orange', es: 'naranja' },
  { hex: '#f472b6', en: 'pink', es: 'rosa' },
  { hex: '#a78bfa', en: 'purple', es: 'morado' },
  { hex: '#22d3ee', en: 'cyan', es: 'cian' },
  { hex: '#ffffff', en: 'white', es: 'blanco' },
  { hex: '#000000', en: 'black', es: 'negro' },
  { hex: '#9ca3af', en: 'gray', es: 'gris' },
];

/** The language of the names that are written (what the person reads). */
export type TagLanguage = 'en' | 'es';

/** The color a word names (in either language), or undefined. */
function colorFromName(word: string): string | undefined {
  const lower = word.toLowerCase();
  return NAMED_COLORS.find(function named(color) {
    return color.en === lower || color.es === lower;
  })?.hex;
}

/** A color as short as it can be written: its name when it has one, else its hex without the "#" (three digits when they allow it). */
function shortColor(color: string, language: TagLanguage): string {
  const lower = color.toLowerCase();
  const named = NAMED_COLORS.find(function same(item) {
    return item.hex === lower;
  });
  if (named) return named[language];
  const hex = lower.replace('#', '');
  return hex.length === 6 && hex[0] === hex[1] && hex[2] === hex[3] && hex[4] === hex[5]
    ? hex[0]! + hex[2]! + hex[4]!
    : hex;
}

/** The opening tag of a color: [c=red], [c=rojo] or, for a color without a name, [c=f06] / [c=ff5577]. */
export function colorOpen(hex: string, language: TagLanguage = 'en'): string {
  return '[c=' + shortColor(hex, language) + ']';
}

/** The opening tag of a gradient: its name when it has one, else its colors as short as they can be: [d=rojo,0cf]. */
export function gradientOpen(colors: string[], language: TagLanguage = 'en'): string {
  const joined = colors.join(',').toLowerCase();
  for (const [name, list] of Object.entries(NAMED)) {
    if (list.join(',').toLowerCase() === joined) return '[d=' + name + ']';
  }
  return (
    '[d=' +
    colors
      .map(function short(color) {
        return shortColor(color, language);
      })
      .join(',') +
    ']'
  );
}

/** The closing tag of a gradient. */
export const GRADIENT_CLOSE = '[/d]';

const MAX_DEPTH = 6;
const HEX = /^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|((?<![A-Za-z0-9])_[^_\n]+_(?![A-Za-z0-9]))|(https?:\/\/[^\s<>"'[\]]+)/g;

/** Finds the marks of a line (bold, italic, colors, gradients, links) and turns them into pieces. */
function parseInline(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ type: 'text', text: text.slice(last, index) });
    const token = match[0];
    if (match[1]) out.push({ type: 'code', text: token.slice(1, -1) });
    else if (match[2]) out.push({ type: 'bold', text: token.slice(2, -2) });
    else if (match[3]) out.push({ type: 'strike', text: token.slice(2, -2) });
    else if (match[4] || match[5]) out.push({ type: 'italic', text: token.slice(1, -1) });
    else {
      // * Trailing punctuation is almost never part of the URL.
      const trimmed = token.replace(/[.,;:!?)\]]+$/, '');
      out.push({ type: 'link', href: trimmed, text: trimmed });
      if (trimmed.length < token.length)
        out.push({ type: 'text', text: token.slice(trimmed.length) });
    }
    last = index + token.length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

interface Frame {
  kind: 'c' | 'g' | 'rainbow';
  colors: string[];
  children: Segment[];
}

const TAG = /\[(c|g|d)=([#0-9a-zA-Z,]{3,60})\]|\[(rainbow)\]|\[\/(c|g|d|rainbow)\]/g;

/** Colour tags nest with each other and with the inline formatting inside them. */
function parseColors(input: string): Segment[] {
  const root: Frame = { kind: 'c', colors: [], children: [] };
  const stack: Frame[] = [root];
  const top = function () {
    return stack[stack.length - 1]!;
  };
  const close = function () {
    const frame = stack.pop()!;
    const seg: Segment =
      frame.kind === 'c'
        ? { type: 'color', color: frame.colors[0]!, children: frame.children }
        : { type: 'gradient', colors: frame.colors, children: frame.children };
    top().children.push(seg);
  };
  let last = 0;
  for (const m of input.matchAll(TAG)) {
    const index = m.index ?? 0;
    if (index > last) top().children.push(...parseInline(input.slice(last, index)));
    last = index + m[0].length;
    if (m[4]) {
      // closing tag: only valid if it matches the innermost open one
      const kind = (m[4] === 'd' ? 'g' : m[4]) as Frame['kind'];
      if (stack.length > 1 && top().kind === kind) close();
      else top().children.push({ type: 'text', text: m[0] });
    } else {
      const kind = (m[1] === 'd' ? 'g' : (m[1] ?? m[3])) as Frame['kind'];
      const named = m[1] === 'd' ? NAMED[(m[2] ?? '').toLowerCase()] : undefined;
      const colors = kind === 'rainbow' ? RAINBOW : (named ?? (m[2] ?? '').split(',').map(toColor));
      const valid =
        colors.every(function (c) {
          return HEX.test(c);
        }) && (kind === 'c' ? colors.length === 1 : colors.length >= 2 && colors.length <= 6);
      if (valid && stack.length <= MAX_DEPTH) stack.push({ kind, colors, children: [] });
      else top().children.push({ type: 'text', text: m[0] });
    }
  }
  if (last < input.length) top().children.push(...parseInline(input.slice(last)));
  while (stack.length > 1) close(); // unclosed tags still colour the rest of the message
  return root.children;
}

/** What an item of a tag means as a color: a name (English or Spanish), or a hex that may come without its "#". */
function toColor(item: string): string {
  if (/^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(item)) {
    return item.startsWith('#') ? item : '#' + item;
  }
  return colorFromName(item) ?? item;
}

/**
 * ! Splits a message into code blocks and lines with marks; the result is data, never HTML, so nothing can inject code.
 */
export function parseRichText(input: string): Segment[] {
  const out: Segment[] = [];
  const fence = /```([A-Za-z0-9_+-]*)\n?([\s\S]*?)```/g;
  let last = 0;
  for (const match of input.matchAll(fence)) {
    const index = match.index ?? 0;
    if (index > last) out.push(...parseColors(input.slice(last, index)));
    out.push({
      type: 'codeblock',
      lang: match[1] ?? '',
      code: (match[2] ?? '').replace(/\n$/, ''),
    });
    last = index + match[0].length;
  }
  if (last < input.length) out.push(...parseColors(input.slice(last)));
  return out;
}

/** Strips tags for previews / notifications. */
export function plainText(input: string): string {
  return input.replace(/\[(?:c|g|d)=[#0-9a-zA-Z,]+\]|\[\/?(?:c|g|d|rainbow)\]/g, '');
}

/** Lines that look like code: a statement end, a keyword at the start, an arrow, a brace, a call or indentation. */
const CODE_LINE =
  /[;{}]\s*$|^\s*(?:const|let|var|function|class|import|export|return|if|else|for|while|def|public|private|async|await|interface|type|#include|using|package)\b|=>|\)\s*\{|^\s*\/\/|^\s*<\/?[a-z][^>]*>\s*$|^\s{2,}\S.*[();,]$|^\s*[\w.$]+\([^)]*\);?$|^\s*["'][\w-]+["']\s*:\s*\S|^\s*(?:npm|pnpm|yarn|git|docker|sudo|pip|curl|cd)\s+\S|^\s*(?:def|elif|else|try|except|class)\b.*:\s*$|^\s*(?:print|console\.log|System\.out\.println)\(/;

/**
 * When a message is clearly code and has no code block yet, wraps it in one so it is shown formatted.
 * A single line needs a strong sign (a keyword or arrow plus a statement end); several lines need most of them to look like code.
 */
export function autoFenceCode(input: string): string {
  if (input.includes('```')) {
    return input;
  }
  const lines = input.split('\n').filter(isFilled);
  if (!lines.length) {
    return input;
  }
  let codeLines = 0;
  for (const line of lines) {
    if (CODE_LINE.test(line)) {
      codeLines++;
    }
  }
  const multi = lines.length >= 2 && codeLines / lines.length >= 0.6 && codeLines >= 2;
  const single =
    lines.length === 1 && /(?:=>|\)\s*\{|;\s*$)/.test(lines[0]!) && /[=(){}]/.test(lines[0]!);
  if (!multi && !single) {
    return input;
  }
  return '```\n' + input.replace(/\s+$/, '') + '\n```';
}

/** True for a line that is not blank. */
function isFilled(line: string): boolean {
  return line.trim().length > 0;
}
