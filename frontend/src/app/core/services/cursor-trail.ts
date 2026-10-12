/**
 * src/app/core/services/cursor-trail.ts
 * The trail that the cursor leaves while it moves, painted on a full-screen canvas: smooth ribbons (comet,
 * ribbon, rainbow), soft lights (glow), ink drops and particles (stardust, bubbles, fire). Every ribbon is
 * painted piece by piece with flat ends, so it never shows beads or glitches, not even when it crosses itself.
 */

/** The kinds of trail. */
export type TrailType =
  'comet' | 'ribbon' | 'glow' | 'ink' | 'rainbow' | 'stardust' | 'bubbles' | 'fire';

/** How the trail looks. `color` and `color2` are the accent and the second accent of the theme ("#rrggbb"). */
export interface TrailConfig {
  type: TrailType;
  color: string;
  color2: string;
  /** Thickness multiplier (1 is normal). */
  scale: number;
  /** Length multiplier (1 is normal): how long it takes for the trail to fade. */
  length: number;
}

/** One recorded position of the pointer. */
interface TrailPoint {
  x: number;
  y: number;
  time: number;
}

/** A little particle of the stardust, bubbles and fire trails. */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Remaining life, from 1 down to 0. */
  life: number;
  size: number;
  /** Random number between 0 and 1 that picks the color of the particle. */
  tone: number;
}

/** How long (ms) a point of the trail lasts before it fades, for each type. */
const LIFETIME: Record<TrailType, number> = {
  comet: 300,
  ribbon: 360,
  glow: 340,
  ink: 400,
  rainbow: 400,
  stardust: 340,
  bubbles: 360,
  fire: 340,
};

/** Most points and particles kept at the same time. */
const MAX_POINTS = 80;
const MAX_PARTICLES = 160;

/** Converts "#rrggbb" into "r, g, b". */
function rgbOf(hex: string): string {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#2ef2b0';
  return (
    parseInt(value.slice(1, 3), 16) +
    ', ' +
    parseInt(value.slice(3, 5), 16) +
    ', ' +
    parseInt(value.slice(5, 7), 16)
  );
}

/** Mixes two colors written as "r, g, b" (amount 0 gives the first one, 1 the second). */
function mixColors(first: string, second: string, amount: number): string {
  const a = first.split(',').map(Number);
  const b = second.split(',').map(Number);
  const mixed: number[] = [];
  for (let index = 0; index < 3; index++) {
    mixed.push(Math.round(a[index] + (b[index] - a[index]) * amount));
  }
  return mixed.join(', ');
}

/** Color of the soft halo of the comet. */
function cometHalo(rgb: string, age: number): string {
  return 'rgba(' + rgb + ', ' + age * 0.16 + ')';
}

/** Color of the body of the comet. */
function cometBody(rgb: string, age: number): string {
  return 'rgba(' + rgb + ', ' + age * 0.8 + ')';
}

/** White core, used by the comet and the ribbon. */
function whiteCore(strength: number, age: number): string {
  return 'rgba(255, 255, 255, ' + age * strength + ')';
}

/** Color of the ribbon: the main color turning into the second one as it gets older. */
function ribbonColor(rgb1: string, rgb2: string, age: number): string {
  return 'rgba(' + mixColors(rgb1, rgb2, 1 - age) + ', ' + age * 0.8 + ')';
}

/** Color of the rainbow: the hue moves along the trail and with time. */
function rainbowColor(phase: number, age: number): string {
  return 'hsla(' + ((phase + (1 - age) * 200) % 360) + ', 90%, 62%, ' + age * 0.85 + ')';
}

/** The canvas and the painter of one trail. */
export class CursorTrail {
  /** The canvas the trail is painted on (it covers the whole window). */
  readonly canvas: HTMLCanvasElement;

  private points: TrailPoint[] = [];
  private particles: Particle[] = [];
  private frame = 0;
  private phase = 0;
  private readonly resizeHandler = this.fitCanvas.bind(this);

  /** Creates the canvas and adds it to the page. */
  constructor(private readonly config: TrailConfig) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'cursor-trail';
    this.canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.canvas);
    this.fitCanvas();
    window.addEventListener('resize', this.resizeHandler);
  }

  /** Removes the canvas and stops painting. */
  destroy(): void {
    cancelAnimationFrame(this.frame);
    window.removeEventListener('resize', this.resizeHandler);
    this.canvas.remove();
    this.points = [];
    this.particles = [];
  }

  /** Makes the canvas as big as the window. */
  private fitCanvas(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  /** Records a pointer position (smoothed with the previous one) and releases particles if the type uses them. */
  addPoint(x: number, y: number): void {
    const previous = this.points[this.points.length - 1];
    if (previous && Math.hypot(x - previous.x, y - previous.y) < 1.2) {
      return;
    }
    const smoothX = previous ? previous.x * 0.35 + x * 0.65 : x;
    const smoothY = previous ? previous.y * 0.35 + y * 0.65 : y;
    this.points.push({ x: smoothX, y: smoothY, time: performance.now() });
    if (this.points.length > MAX_POINTS) {
      this.points.shift();
    }
    const type = this.config.type;
    if (type === 'stardust' || type === 'bubbles' || type === 'fire') {
      this.emitParticles(type, smoothX, smoothY);
    }
    if (!this.frame) {
      this.frame = requestAnimationFrame(this.paint.bind(this));
    }
  }

  /** Releases two or three particles around a point. */
  private emitParticles(type: TrailType, x: number, y: number): void {
    const count = type === 'fire' ? 3 : 2;
    for (let index = 0; index < count; index++) {
      let size = 1.5 + Math.random() * 2.5;
      if (type === 'bubbles') {
        size = 3 + Math.random() * 5;
      } else if (type === 'fire') {
        size = 3 + Math.random() * 4;
      }
      this.particles.push({
        x: x + (Math.random() - 0.5) * 5,
        y: y + (Math.random() - 0.5) * 5,
        vx: (Math.random() - 0.5) * (type === 'fire' ? 0.9 : 1.4),
        vy: type === 'stardust' ? (Math.random() - 0.5) * 1.4 - 0.2 : -(0.4 + Math.random() * 1.1),
        life: 1,
        size,
        tone: Math.random(),
      });
    }
    if (this.particles.length > MAX_PARTICLES) {
      this.particles.splice(0, this.particles.length - MAX_PARTICLES);
    }
  }

  /**
   * Paints a ribbon that follows the points piece by piece: the width of each piece is `width` times its age
   * (thinner the older it is) and its color comes from `colorOf`. Each piece is painted once with flat ends,
   * so nothing overlaps twice.
   */
  private ribbon(
    ctx: CanvasRenderingContext2D,
    width: number,
    now: number,
    life: number,
    colorOf: (age: number) => string,
  ): void {
    ctx.lineCap = 'butt';
    for (let index = 1; index < this.points.length; index++) {
      const age = Math.max(0, 1 - (now - this.points[index].time) / life);
      if (age <= 0.02) {
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(this.points[index - 1].x, this.points[index - 1].y);
      ctx.lineTo(this.points[index].x, this.points[index].y);
      ctx.lineWidth = Math.max(0.6, width * age);
      ctx.strokeStyle = colorOf(age);
      ctx.stroke();
    }
    ctx.lineCap = 'round';
  }

  /** Paints one frame and asks for the next while there is something left to fade. */
  private paint(): void {
    this.frame = 0;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    const config = this.config;
    const now = performance.now();
    const length = Math.min(1.5, Math.max(0.3, config.length));
    const scale = Math.min(3, Math.max(0.4, config.scale));
    const life = LIFETIME[config.type] * length;
    const rgb1 = rgbOf(config.color);
    const rgb2 = rgbOf(config.color2);
    this.points = this.points.filter(function stillAlive(point: TrailPoint): boolean {
      return now - point.time < life;
    });
    this.phase = (this.phase + 4) % 360;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (config.type) {
      case 'comet':
        this.ribbon(ctx, 20 * scale, now, life, cometHalo.bind(null, rgb1));
        this.ribbon(ctx, 10 * scale, now, life, cometBody.bind(null, rgb1));
        this.ribbon(ctx, 3.2 * scale, now, life, whiteCore.bind(null, 0.75));
        break;
      case 'ribbon':
        this.ribbon(ctx, 9 * scale, now, life, ribbonColor.bind(null, rgb1, rgb2));
        this.ribbon(ctx, 2.4 * scale, now, life, whiteCore.bind(null, 0.7));
        break;
      case 'rainbow':
        this.ribbon(ctx, 8 * scale, now, life, rainbowColor.bind(null, this.phase));
        break;
      case 'glow':
        this.paintGlow(ctx, now, life, scale, rgb1);
        break;
      case 'ink':
        this.paintInk(ctx, now, life, scale, rgb1);
        break;
      default:
        this.paintParticles(ctx, config.type, length, scale, rgb1, rgb2);
        break;
    }
    if (this.points.length > 0 || this.particles.length > 0) {
      this.frame = requestAnimationFrame(this.paint.bind(this));
    }
  }

  /** Soft spots of light in the main color. */
  private paintGlow(
    ctx: CanvasRenderingContext2D,
    now: number,
    life: number,
    scale: number,
    rgb: string,
  ): void {
    for (const point of this.points) {
      const age = Math.max(0, 1 - (now - point.time) / life);
      const radius = (3 + age * 15) * scale;
      const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
      gradient.addColorStop(0, 'rgba(' + rgb + ', ' + age * 0.55 + ')');
      gradient.addColorStop(1, 'rgba(' + rgb + ', 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Drops that shrink as they age, like a brush stroke that dries. */
  private paintInk(
    ctx: CanvasRenderingContext2D,
    now: number,
    life: number,
    scale: number,
    rgb: string,
  ): void {
    for (let index = 1; index < this.points.length; index++) {
      const age = Math.max(0, 1 - (now - this.points[index].time) / life);
      const from = this.points[index - 1];
      const to = this.points[index];
      const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 2.5));
      ctx.fillStyle = 'rgba(' + rgb + ', ' + age * 0.7 + ')';
      for (let step = 0; step < steps; step++) {
        const t = step / steps;
        ctx.beginPath();
        ctx.arc(
          from.x + (to.x - from.x) * t,
          from.y + (to.y - from.y) * t,
          (0.8 + age * 5) * scale,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
  }

  /** Moves and paints the particles of the stardust, bubbles and fire trails. */
  private paintParticles(
    ctx: CanvasRenderingContext2D,
    type: TrailType,
    length: number,
    scale: number,
    rgb1: string,
    rgb2: string,
  ): void {
    for (const particle of this.particles) {
      particle.x += particle.vx;
      particle.y += particle.vy;
      if (type === 'stardust') {
        particle.vy += 0.03;
      }
      if (type === 'bubbles') {
        particle.vx += (Math.random() - 0.5) * 0.12;
      }
      particle.life -= (type === 'fire' ? 0.03 : 0.02) / length;
    }
    this.particles = this.particles.filter(function isAlive(particle: Particle): boolean {
      return particle.life > 0;
    });
    for (const particle of this.particles) {
      if (type === 'stardust') {
        this.paintStar(ctx, particle, scale, rgb1);
      } else if (type === 'bubbles') {
        ctx.strokeStyle =
          'rgba(' + (particle.tone > 0.5 ? rgb1 : rgb2) + ', ' + particle.life * 0.8 + ')';
        ctx.fillStyle = 'rgba(255, 255, 255, ' + particle.life * 0.08 + ')';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(
          particle.x,
          particle.y,
          particle.size * (0.6 + (1 - particle.life) * 0.6) * scale,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.stroke();
      } else {
        // Flame: from yellow to orange and red as it dies out.
        const hue = 55 - (1 - particle.life) * 55;
        ctx.fillStyle =
          'hsla(' +
          hue +
          ', 100%, ' +
          (50 + particle.life * 15) +
          '%, ' +
          particle.life * 0.8 +
          ')';
        ctx.beginPath();
        ctx.arc(
          particle.x,
          particle.y,
          (particle.size * particle.life + 0.5) * scale,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
  }

  /** A four-pointed sparkle. */
  private paintStar(
    ctx: CanvasRenderingContext2D,
    particle: Particle,
    scale: number,
    rgb: string,
  ): void {
    ctx.fillStyle =
      'rgba(' + (particle.tone > 0.5 ? '255, 255, 255' : rgb) + ', ' + particle.life * 0.9 + ')';
    const radius = particle.size * (0.5 + particle.life * 0.7) * scale;
    const x = particle.x;
    const y = particle.y;
    ctx.beginPath();
    ctx.moveTo(x, y - radius * 1.6);
    ctx.lineTo(x + radius * 0.45, y - radius * 0.45);
    ctx.lineTo(x + radius * 1.6, y);
    ctx.lineTo(x + radius * 0.45, y + radius * 0.45);
    ctx.lineTo(x, y + radius * 1.6);
    ctx.lineTo(x - radius * 0.45, y + radius * 0.45);
    ctx.lineTo(x - radius * 1.6, y);
    ctx.lineTo(x - radius * 0.45, y - radius * 0.45);
    ctx.closePath();
    ctx.fill();
  }
}
