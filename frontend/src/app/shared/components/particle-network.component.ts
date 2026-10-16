/**
 * src/app/shared/components/particle-network.component.ts
 * Animated particles on a canvas (network, bokeh or flow) for backgrounds.
 */
import {
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  afterNextRender,
  inject,
  input,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** Depth 0-1: the near ones are bigger, brighter and move more with the mouse (bokeh mode). */
  z: number;
  /** Own phase of the twinkle and the sway. */
  fase: number;
  /** Which color sprite it uses (bokeh mode). */
  tono: number;
  /** Previous position, to draw the trail (flow mode). */
  px: number;
  py: number;
}

/**
 * Animated particle network on a canvas: dots that float and join with lines when they are close.
 * It is light (a few dozen dots), adapts to the size and the screen, uses the current accent color
 * and stops by itself when the tab is hidden or motion is reduced.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-particle-network',
  standalone: true,
  template: `<canvas
    #canvasRef
    class="absolute inset-0 h-full w-full"
    aria-hidden="true"
  ></canvas>`,
  host: { class: 'pointer-events-none absolute inset-0 block' },
})
export class ParticleNetworkComponent implements OnDestroy {
  /** Multiplicador de velocidad (1 = normal). */
  readonly velocidad = input(1);
  /** 'bokeh': soft dots with glow and depth (sign-in); 'network': dots joined by lines. */
  readonly estilo = input<'bokeh' | 'red' | 'flow'>('red');
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvasRef');
  private readonly hostEl = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zona = inject(NgZone);

  private particulas: Particle[] = [];
  private ancho = 0;
  private alto = 0;
  private escala = 1;
  private frameId = 0;
  private resizeObserver: ResizeObserver | null = null;
  private color = '46, 242, 176';
  private color2 = '139, 92, 246';
  private sprites: HTMLCanvasElement[] = [];
  private pointerX = 0;
  private pointerY = 0;
  private suaveX = 0;
  private suaveY = 0;
  /** Position of the mouse in pixels (the lights of the sign-in pages move away from it). */
  private pointerPx = -1000;
  private pointerPy = -1000;
  private t0 = performance.now();
  private readonly alMoverRaton = this.moveMouse.bind(this);
  private readonly onVisibilityChange = this.handleVisibility.bind(this);

  constructor() {
    afterNextRender(this.begin.bind(this));
  }

  /** Starts the animation: reads the color, measures the box and follows its size. */
  private begin(): void {
    this.readColor();
    this.fitBox();
    this.resizeObserver = new ResizeObserver(this.fitBox.bind(this));
    this.resizeObserver.observe(this.hostEl.nativeElement);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('pointermove', this.alMoverRaton, { passive: true });
    this.crearSprites();
    this.startLoop();
  }

  /** Reads the accent color (hex) and turns it into "r, g, b" so transparencies can be used. */
  private readColor(): void {
    const estilos = getComputedStyle(document.documentElement);
    const convertir = function (hex: string, fallback: string): string {
      return /^#[0-9a-f]{6}$/i.test(hex)
        ? [1, 3, 5]
            .map(function (i) {
              return parseInt(hex.slice(i, i + 2), 16);
            })
            .join(', ')
        : fallback;
    };
    this.color = convertir(estilos.getPropertyValue('--accent').trim(), this.color);
    this.color2 = convertir(estilos.getPropertyValue('--accent-2').trim(), this.color2);
  }

  /** Measures the box and the density of the screen so the canvas is sharp. */
  private fitBox(): void {
    const box = this.hostEl.nativeElement.getBoundingClientRect();
    this.ancho = Math.max(1, Math.round(box.width));
    this.alto = Math.max(1, Math.round(box.height));
    this.escala = this.estilo() === 'flow' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    const canvas = this.canvasRef().nativeElement;
    canvas.width = this.ancho * this.escala;
    canvas.height = this.alto * this.escala;
    const cantidad =
      this.estilo() === 'flow'
        ? Math.max(45, Math.min(85, Math.round((this.ancho * this.alto) / 24000)))
        : this.estilo() === 'bokeh'
          ? Math.max(40, Math.min(90, Math.round((this.ancho * this.alto) / 16000)))
          : Math.max(28, Math.min(80, Math.round((this.ancho * this.alto) / 20000)));
    while (this.particulas.length < cantidad) this.particulas.push(this.spawn());
    this.particulas.length = cantidad;
  }

  /** A new particle with a random place, direction and speed. */
  private spawn(): Particle {
    const angle = Math.random() * Math.PI * 2;
    const rapidez = 0.12 + Math.random() * 0.28;
    return {
      x: Math.random() * (this.ancho || 800),
      y: Math.random() * (this.alto || 600),
      vx: Math.cos(angle) * rapidez,
      vy: Math.sin(angle) * rapidez,
      r: 0.8 + Math.random() * 1.6,
      z: Math.random(),
      fase: Math.random() * Math.PI * 2,
      tono: Math.floor(Math.random() * 3),
      px: 0,
      py: 0,
    };
  }

  /** Dots with a soft halo, drawn once and reused (so every frame is cheap). */
  private crearSprites(): void {
    const colores = [this.color, this.color2, '255, 255, 255'];
    this.sprites = colores.map(function (rgb) {
      const canvasRef = document.createElement('canvas');
      canvasRef.width = canvasRef.height = 64;
      const c = canvasRef.getContext('2d')!;
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, `rgba(${rgb}, 0.95)`);
      g.addColorStop(0.25, `rgba(${rgb}, 0.45)`);
      g.addColorStop(1, `rgba(${rgb}, 0)`);
      c.fillStyle = g;
      c.fillRect(0, 0, 64, 64);
      return canvasRef;
    });
  }

  /** Remembers where the pointer is, so the particles lean toward it. */
  private moveMouse(evento: PointerEvent): void {
    this.pointerPx = evento.clientX;
    this.pointerPy = evento.clientY;
    this.pointerX = evento.clientX / Math.max(1, window.innerWidth) - 0.5;
    this.pointerY = evento.clientY / Math.max(1, window.innerHeight) - 0.5;
  }

  /** Soft flow field: angle of the wind at each point (a sum of sines that evolves slowly). */
  private angle(x: number, y: number, t: number): number {
    return (
      (Math.sin(x * 0.0021 + t * 0.11) +
        Math.sin(y * 0.0027 - t * 0.09) +
        Math.sin((x + y) * 0.0015 + t * 0.06)) *
      1.35
    );
  }

  /**
   * "Flow" style: soft points of light that glide along a flow field, appear and fade out.
   * No trails: the canvas is cleared on every frame and few sprites are drawn, so it is light in Firefox too.
   */
  private dibujarFlujo(velocidad: number): void {
    const ctx = this.canvasRef().nativeElement.getContext('2d');
    if (!ctx) return;
    const t = (performance.now() - this.t0) / 1000;
    this.suaveX += (this.pointerX - this.suaveX) * 0.03;
    this.suaveY += (this.pointerY - this.suaveY) * 0.03;
    ctx.setTransform(this.escala, 0, 0, this.escala, 0, 0);
    ctx.clearRect(0, 0, this.ancho, this.alto);
    const radio = 150;
    for (const p of this.particulas) {
      const a = this.angle(p.x, p.y, t);
      const rapidez = (0.25 + p.z * 0.6) * velocidad;
      p.x += Math.cos(a) * rapidez;
      p.y += Math.sin(a) * rapidez;
      // Reaction to the mouse: the nearby lights move away gently.
      const dx = p.x - this.pointerPx;
      const dy = p.y - this.pointerPy;
      const d2 = dx * dx + dy * dy;
      if (d2 < radio * radio && d2 > 1) {
        const d = Math.sqrt(d2);
        const empuje = (1 - d / radio) * 2.4 * velocidad;
        p.x += (dx / d) * empuje;
        p.y += (dy / d) * empuje;
      }
      // `phase` is the life (0 to 1): when born and when dying the light fades softly.
      p.fase += 0.0016 * velocidad;
      if (p.fase >= 1 || p.x < -30 || p.x > this.ancho + 30 || p.y < -30 || p.y > this.alto + 30) {
        p.x = Math.random() * this.ancho;
        p.y = Math.random() * this.alto;
        p.fase = 0;
        continue;
      }
      const tamano = 10 + p.z * 24;
      ctx.globalAlpha = Math.sin(p.fase * Math.PI) * (0.25 + p.z * 0.4);
      ctx.drawImage(
        this.sprites[p.tono % this.sprites.length]!,
        p.x - tamano / 2,
        p.y - tamano / 2,
        tamano,
        tamano,
      );
    }
    ctx.globalAlpha = 1;
  }

  /** "Bokeh" style: soft lights that float upwards with a sway, twinkle and move with the mouse. */
  private dibujarBokeh(velocidad: number): void {
    const ctx = this.canvasRef().nativeElement.getContext('2d');
    if (!ctx) return;
    const t = (performance.now() - this.t0) / 1000;
    this.suaveX += (this.pointerX - this.suaveX) * 0.04;
    this.suaveY += (this.pointerY - this.suaveY) * 0.04;
    ctx.setTransform(this.escala, 0, 0, this.escala, 0, 0);
    ctx.clearRect(0, 0, this.ancho, this.alto);
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particulas) {
      p.y -= (0.1 + p.z * 0.35) * velocidad;
      p.x += Math.sin(t * 0.4 + p.fase) * 0.18 * velocidad;
      if (p.y < -40) {
        p.y = this.alto + 40;
        p.x = Math.random() * this.ancho;
      }
      const tamano = 14 + p.z * 46;
      const brillo = 0.25 + p.z * 0.55;
      const parpadeo = 0.7 + 0.3 * Math.sin(t * (0.6 + p.z) + p.fase);
      const x = p.x + this.suaveX * (20 + p.z * 70);
      const y = p.y + this.suaveY * (20 + p.z * 70);
      ctx.globalAlpha = Math.min(1, brillo * parpadeo);
      ctx.drawImage(
        this.sprites[p.tono % this.sprites.length]!,
        x - tamano / 2,
        y - tamano / 2,
        tamano,
        tamano,
      );
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Starts the loop of frames (outside Angular so it does not check the whole page on every frame). */
  private startLoop(): void {
    if (this.frameId || document.hidden) return;
    // ! Outside the Angular zone: animating must not trigger change detection on every frame.
    this.zona.runOutsideAngular(this.loop.bind(this));
  }

  /** One frame: moves and draws the particles (nothing moves when the person asked for no motion). */
  private loop(): void {
    // On weak devices every other frame is skipped (30 per second) and the motion is doubled to keep its speed.
    const weak = document.documentElement.dataset['perf'] === 'low';
    if (weak && (this.skipFrame = !this.skipFrame)) {
      this.frameId = requestAnimationFrame(this.loop.bind(this));
      return;
    }
    const reducido =
      document.documentElement.dataset['motion'] === 'reduced' ||
      document.documentElement.dataset['bg'] === 'still';
    const velocidad = reducido ? 0 : this.velocidad() * (weak ? 2 : 1);
    if (this.estilo() === 'flow') this.dibujarFlujo(velocidad);
    else if (this.estilo() === 'bokeh') this.dibujarBokeh(velocidad);
    else this.draw(velocidad);
    this.frameId = requestAnimationFrame(this.loop.bind(this));
  }

  private skipFrame = false;

  /** Stops the animation while the page is hidden and starts it again when it is seen. */
  private handleVisibility(): void {
    if (document.hidden) {
      cancelAnimationFrame(this.frameId);
      this.frameId = 0;
    } else {
      this.startLoop();
    }
  }

  /** Draws the particles and the lines between those that are close. */
  private draw(velocidad: number): void {
    const ctx = this.canvasRef().nativeElement.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(this.escala, 0, 0, this.escala, 0, 0);
    ctx.clearRect(0, 0, this.ancho, this.alto);
    const ps = this.particulas;
    for (const p of ps) {
      p.x += p.vx * velocidad;
      p.y += p.vy * velocidad;
      if (p.x < -10) p.x = this.ancho + 10;
      else if (p.x > this.ancho + 10) p.x = -10;
      if (p.y < -10) p.y = this.alto + 10;
      else if (p.y > this.alto + 10) p.y = -10;
    }
    const alcance = 140;
    ctx.lineWidth = 1;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i]!;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j]!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < alcance * alcance) {
          ctx.strokeStyle = `rgba(${this.color}, ${(1 - Math.sqrt(d2) / alcance) * 0.22})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    ctx.fillStyle = `rgba(${this.color}, 0.65)`;
    for (const p of ps) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Stops the animation and the listeners. */
  ngOnDestroy(): void {
    cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.resizeObserver?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('pointermove', this.alMoverRaton);
  }
}
