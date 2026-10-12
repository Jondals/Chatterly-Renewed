/**
 * src/app/features/settings/audio-section.component.ts
 * Settings - Voice & video: devices, microphone processing, voice improvements, camera and private mode.
 */
import {
  Component,
  DestroyRef,
  EnvironmentInjector,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { I18nService, TranslatePipe } from '../../core/i18n/i18n.service';
import { CallService } from '../../core/services/call.service';
import {
  desktopBridge,
  type DesktopGraphicsState,
  type GraphicsBackend,
} from '../../core/desktop-bridge';
import { SettingsService } from '../../core/services/settings.service';
import { ToastService } from '../../core/services/toast.service';
import { IconComponent } from '../../shared/components/icon.component';
import { SelectComponent, type SelectOption } from '../../shared/components/select.component';
import {
  SegmentedComponent,
  SettingRowComponent,
  ToggleComponent,
} from '../../shared/components/controls.component';
import { VOICE_MODES, buildVoiceChain } from '../../core/audio-chain';
import { decibels } from '../../shared/util/audio-level';

/** Devices, microphone processing and call privacy. */
@Component({
  selector: 'app-audio-section',
  standalone: true,
  imports: [
    IconComponent,
    TranslatePipe,
    SegmentedComponent,
    SettingRowComponent,
    ToggleComponent,
    SelectComponent,
  ],
  template: `
    <div class="mb-6 flex gap-3 rounded-ui border border-accent/25 bg-accent/8 p-4 text-sm">
      <app-icon name="lock" class="mt-0.5 shrink-0 text-accent" />
      <p class="text-muted">
        <b class="text-fg">{{ 'Calls are end-to-end encrypted.' | t }}</b>
        {{
          'Every audio and video frame is encrypted on your device with keys from a fresh exchange per call, on top of DTLS-SRTP. The server never sees media.'
            | t
        }}
      </p>
    </div>

    <section class="grid gap-4 sm:grid-cols-2">
      <div class="block">
        <span class="label">{{ 'Microphone' | t }}</span>
        <app-select
          class="mt-1.5"
          label="Microphone"
          [options]="inputOptions()"
          [value]="s.inputDeviceId()"
          (valueChange)="setInput($event)"
          (opened)="refreshDevices()"
        />
      </div>
      <div class="block">
        <span class="label">{{ 'Speakers' | t }}</span>
        <app-select
          class="mt-1.5"
          label="Speakers"
          [options]="outputOptions()"
          [value]="s.outputDeviceId()"
          (valueChange)="s.outputDeviceId.set($event)"
          (opened)="refreshDevices()"
        />
      </div>
    </section>

    <section class="settings-card">
      <div class="mb-3 flex items-center justify-between">
        <span class="label">{{ 'Microphone test' | t }}</span
        ><b class="font-mono text-xs text-accent">{{ dbfs(level()) }} dB</b>
      </div>
      <div class="flex h-10 items-end gap-[3px]">
        @for (b of bars; track $index) {
          <span
            class="flex-1 rounded-sm transition-[height,background] duration-100"
            [style.height.%]="testing() ? 12 + Math.min(1, level() * (0.6 + b)) * 88 : 12"
            [style.background]="
              testing() && level() * (0.6 + b) > gate() ? 'var(--accent)' : 'rgba(255,255,255,.14)'
            "
          ></span>
        }
      </div>
      <label class="mt-3 block text-xs text-muted"
        >{{ 'Input gate' | t }} <b class="float-right text-fg">{{ s.inputGate() }}%</b>
        <input
          type="range"
          min="0"
          max="60"
          class="mt-1 w-full accent-[var(--accent)]"
          [value]="s.inputGate()"
          (input)="s.inputGate.set(+$any($event.target).value)"
      /></label>
      <button
        class="btn btn-sm mt-3"
        [class.btn-active]="testing()"
        type="button"
        (click)="toggleTest()"
      >
        <app-icon [name]="testing() ? 'stop' : 'mic'" [size]="14" />
        {{ (testing() ? 'Stop test' : 'Test microphone') | t }}
      </button>
    </section>

    <section class="settings-card">
      <h2 class="settings-card-title">{{ 'Microphone processing' | t }}</h2>
      <app-setting-row
        title="Noise suppression"
        hint="Filters keyboard and background noise (browser processing)."
        ><app-toggle
          [checked]="s.noiseSuppression()"
          (checkedChange)="s.noiseSuppression.set($event); apply()"
          [label]="'Noise suppression' | t"
      /></app-setting-row>
      <app-setting-row
        title="Echo cancellation"
        hint="Stops your speakers feeding back into the microphone."
        ><app-toggle
          [checked]="s.echoCancellation()"
          (checkedChange)="s.echoCancellation.set($event); apply()"
          [label]="'Echo cancellation' | t"
      /></app-setting-row>
      <app-setting-row title="Automatic gain" hint="Evens out your volume."
        ><app-toggle
          [checked]="s.autoGain()"
          (checkedChange)="s.autoGain.set($event); apply()"
          [label]="'Automatic gain' | t"
      /></app-setting-row>
      <app-setting-row title="3D spatial audio" hint="Places each voice around you (HRTF)."
        ><app-toggle
          [checked]="s.spatialAudio()"
          (checkedChange)="s.spatialAudio.set($event)"
          [label]="'3D spatial audio' | t"
      /></app-setting-row>
    </section>

    <section class="settings-card">
      <h2 class="settings-card-title">{{ 'Your voice' | t }}</h2>
      <app-setting-row
        title="Microphone volume"
        hint="How loud your voice is before it is sent. Above 100% it is amplified."
      >
        <div class="flex items-center gap-3">
          <input
            type="range"
            min="0"
            max="200"
            class="w-44 accent-[var(--accent)]"
            [value]="s.inputVolume()"
            (input)="s.inputVolume.set(+$any($event.target).value)"
            (change)="apply()"
            [attr.aria-label]="'Microphone volume' | t"
          /><span class="w-10 text-right font-mono text-xs text-muted">{{ s.inputVolume() }}%</span>
        </div>
      </app-setting-row>
      <div class="py-3">
        <div class="text-sm font-semibold">{{ 'Voice mode' | t }}</div>
        <p class="mt-0.5 text-xs text-muted">
          {{
            'Press "Test microphone" and you hear yourself with the mode on: change it and listen to the difference.'
              | t
          }}
        </p>
        <div class="mt-3 grid grid-cols-2 gap-2.5">
          @for (m of voiceModes; track m.id) {
            <button
              type="button"
              class="choice-card"
              [class.is-on]="s.voiceMode() === m.id"
              (click)="s.voiceMode.set(m.id); apply()"
            >
              <span class="text-sm font-semibold">{{ m.label | t }}</span>
              <span class="text-[0.6875rem] leading-snug text-muted">{{ m.hint | t }}</span>
            </button>
          }
        </div>
      </div>
    </section>

    <section class="settings-card">
      <h2 class="settings-card-title">{{ 'Camera' | t }}</h2>
      <app-setting-row
        title="Quality"
        hint="The size of your picture. Higher is sharper and uses more data."
      >
        <app-segmented
          [options]="qualityOptions"
          [value]="s.cameraQuality()"
          (valueChange)="s.cameraQuality.set($any($event)); call.changeCamera()"
        />
      </app-setting-row>
      <app-setting-row
        title="Frames per second"
        hint="Smoother motion at 60, lighter on slow connections at 15."
      >
        <app-segmented
          [options]="fpsOptions"
          [value]="s.cameraFps()"
          (valueChange)="s.cameraFps.set($any($event)); call.changeCamera()"
        />
      </app-setting-row>
      <app-setting-row
        title="Background and adjustments"
        hint="Blur or change what is behind you, and adjust brightness, contrast, color and zoom, with a live preview."
      >
        <button type="button" class="btn btn-sm gap-1.5" (click)="openCameraOptions()">
          <app-icon name="sparkles" [size]="14" /> {{ 'Open' | t }}
        </button>
      </app-setting-row>
    </section>

    @if (graphics(); as g) {
      <section class="settings-card">
        <h2 class="settings-card-title">{{ 'Graphics' | t }}</h2>
        <app-setting-row
          title="Hardware acceleration"
          hint="Uses the graphics card to draw the app and to make the effects of the camera. Turn it off only if the app flickers or shows glitches."
        >
          <app-toggle
            [checked]="g.hardwareAcceleration"
            (checkedChange)="setGraphics({ hardwareAcceleration: $event })"
            [label]="'Hardware acceleration' | t"
          />
        </app-setting-row>
        @if (g.hardwareAcceleration && g.backends.length > 1) {
          <app-setting-row
            title="Graphics layer"
            hint="Automatic picks the best one for your computer. Try another one if you see glitches or the video stutters."
          >
            <app-select
              class="w-56 max-w-full"
              label="Graphics layer"
              [options]="graphicsOptions()"
              [value]="g.backend"
              (valueChange)="setGraphics({ backend: $any($event) })"
            />
          </app-setting-row>
        }
        <p class="pb-2 text-xs text-dim">
          {{ 'Now' | t }}: {{ g.applied.hardwareAcceleration ? ('on' | t) : ('off' | t) }} ·
          {{ g.compositing }}
        </p>
        @if (g.restartRequired) {
          <div
            class="anim-fade-up mb-3 flex flex-wrap items-center gap-3 rounded-ui border border-accent/30 bg-accent/10 px-3 py-2.5 text-xs"
          >
            <span class="min-w-0 flex-1">{{ 'Restart the app to use the new choice.' | t }}</span>
            <button type="button" class="btn btn-sm btn-primary" (click)="restartForGraphics()">
              <app-icon name="refresh" [size]="13" /> {{ 'Restart now' | t }}
            </button>
          </div>
        }
      </section>
    }
  `,
})
export class AudioSectionComponent implements OnDestroy {
  protected readonly s = inject(SettingsService);
  protected readonly call = inject(CallService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  private readonly environment = inject(EnvironmentInjector);

  /** How the graphics card is used (only in the desktop app; null elsewhere). */
  protected readonly graphics = signal<DesktopGraphicsState | null>(null);
  protected readonly graphicsOptions = computed(this.buildGraphicsOptions.bind(this));

  /** The names of the graphics layers. */
  private buildGraphicsOptions(): SelectOption[] {
    const names: Record<string, string> = {
      auto: 'Automatic (recommended)',
      d3d11: 'Direct3D 11',
      gl: 'OpenGL',
      vulkan: 'Vulkan',
      metal: 'Metal',
    };
    const offered = this.graphics()?.backends ?? [];
    return offered.map(
      function option(this: AudioSectionComponent, id: string): SelectOption {
        return { value: id, label: id === 'auto' ? this.i18n.t(names[id]!) : names[id]! };
      }.bind(this),
    );
  }

  /** Reads how the graphics are set (it only exists in the desktop app). */
  private async loadGraphics(): Promise<void> {
    const bridge = desktopBridge()?.graphics;
    if (bridge) {
      this.graphics.set(await bridge.get());
    }
  }

  /** Changes the choice of the graphics (it applies after a restart). */
  protected async setGraphics(
    change: Partial<{ hardwareAcceleration: boolean; backend: GraphicsBackend }>,
  ): Promise<void> {
    const bridge = desktopBridge()?.graphics;
    const now = this.graphics();
    if (!bridge || !now) {
      return;
    }
    this.graphics.set(
      await bridge.set({
        hardwareAcceleration: change.hardwareAcceleration ?? now.hardwareAcceleration,
        backend: change.backend ?? now.backend,
      }),
    );
  }

  /** Starts the app again. */
  protected restartForGraphics(): void {
    void desktopBridge()?.graphics?.restart();
  }

  /** Opens the window of the camera (background, mirror and adjustments, with a live preview). */
  protected async openCameraOptions(): Promise<void> {
    const picker = await import('../voice/background-picker.component');
    picker.openBackgroundPicker(this.environment);
  }

  protected readonly voiceModes = VOICE_MODES;
  protected readonly qualityOptions = [
    { id: '480', label: '480p' },
    { id: '720', label: '720p' },
    { id: '1080', label: '1080p' },
  ];
  protected readonly fpsOptions = [
    { id: '15', label: '15' },
    { id: '30', label: '30' },
    { id: '60', label: '60' },
  ];
  protected readonly Math = Math;
  protected readonly bars = Array.from({ length: 30 }, function (_, i) {
    return Math.abs(Math.sin(i * 0.9)) * 0.5 + 0.25;
  });
  protected readonly inputs = signal<MediaDeviceInfo[]>([]);
  protected readonly outputs = signal<MediaDeviceInfo[]>([]);
  protected readonly testing = signal(false);
  protected readonly level = signal(0);
  protected readonly gate = computed(
    function (this: AudioSectionComponent) {
      return this.s.inputGate() / 100 / 2;
    }.bind(this),
  );

  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  /** The microphones to choose from, with the system default first. */
  protected readonly inputOptions = computed(this.buildInputOptions.bind(this));
  /** The speakers to choose from, with the system default first. */
  protected readonly outputOptions = computed(this.buildOutputOptions.bind(this));
  private readonly changeListener = this.refreshDevices.bind(this);

  /** Lists the devices now and again whenever one is plugged in or taken out. */
  constructor() {
    void this.loadDevices();
    void this.loadGraphics();
    navigator.mediaDevices?.addEventListener?.('devicechange', this.changeListener);
    inject(DestroyRef).onDestroy(this.stopWatchingDevices.bind(this));
  }

  /** Stops following the devices. */
  private stopWatchingDevices(): void {
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.changeListener);
  }

  /** The options of the microphone list. */
  private buildInputOptions(): SelectOption[] {
    return this.deviceOptions(this.inputs(), 'Microphone');
  }

  /** The options of the speakers list. */
  private buildOutputOptions(): SelectOption[] {
    return this.deviceOptions(this.outputs(), 'Speakers');
  }

  /** Turns devices into options: the system default, then every device by its name. */
  private deviceOptions(devices: MediaDeviceInfo[], noun: string): SelectOption[] {
    const options: SelectOption[] = [{ value: 'default', label: this.i18n.t('System default') }];
    devices.forEach(
      function add(this: AudioSectionComponent, device: MediaDeviceInfo, index: number) {
        options.push({
          value: device.deviceId,
          label: device.label || this.i18n.t(noun) + ' ' + (index + 1),
        });
      }.bind(this),
    );
    return options;
  }

  /**
   * Reads the devices again. A browser only gives the names (and the full list) once the page has had access to
   * the microphone, so when names are missing a short access is asked for first.
   */
  protected async refreshDevices(): Promise<void> {
    await this.loadDevices();
    const unnamed = this.inputs().some(function blank(device) {
      return !device.label;
    });
    if (unnamed && !this.testing()) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(function stop(track) {
          track.stop();
        });
        await this.loadDevices();
      } catch {
        // No permission: the list stays as short as the browser allows.
      }
    }
  }

  /**
   * Lists the microphones and speakers (without the virtual 'default' and 'communications' copies of the same device).
   */
  private async loadDevices(): Promise<void> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const virtual = ['default', 'communications'];
      this.inputs.set(
        devices.filter(function (d) {
          return d.kind === 'audioinput' && !virtual.includes(d.deviceId);
        }),
      );
      this.outputs.set(
        devices.filter(function (d) {
          return d.kind === 'audiooutput' && !virtual.includes(d.deviceId);
        }),
      );
    } catch {
      /* no media devices */
    }
  }

  /** Applies a change of device to the call that is going on and to the test of the microphone. */
  protected apply(): void {
    void this.call.changeInputDevice();
    if (this.testing()) void this.start();
  }

  /** Chooses the microphone. */
  protected setInput(id: string): void {
    this.s.inputDeviceId.set(id);
    this.apply();
  }

  /** Starts or stops the test of the microphone. */
  protected toggleTest(): void {
    if (this.testing()) this.stop();
    else void this.start();
  }

  /** Starts the test: opens the microphone and measures its level to draw the meter. */
  private async start(): Promise<void> {
    this.stop();
    try {
      const id = this.s.inputDeviceId();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: id !== 'default' ? { exact: id } : undefined,
          noiseSuppression: this.s.noiseSuppression(),
          echoCancellation: this.s.echoCancellation(),
          autoGainControl: this.s.autoGain(),
        },
      });
      this.ctx = new AudioContext();
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      const chain = buildVoiceChain(this.ctx, {
        inputVolume: this.s.inputVolume(),
        mode: this.s.voiceMode(),
      });
      this.ctx.createMediaStreamSource(this.stream).connect(chain.input);
      chain.output.connect(analyser);
      // You hear yourself while the microphone is tested (with the mode of the voice on, to compare).
      chain.output.connect(this.ctx.destination);
      const data = new Uint8Array(analyser.fftSize);
      this.timer = setInterval(
        function (this: AudioSectionComponent) {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (const v of data) sum += ((v - 128) / 128) ** 2;
          this.level.set(Math.min(1, Math.sqrt(sum / data.length) * 2.2));
        }.bind(this),
        60,
      );
      this.testing.set(true);
      await this.loadDevices(); // labels appear once permission is granted
    } catch {
      this.toast.error(
        this.i18n.t('Microphone unavailable'),
        this.i18n.t('Allow access in your browser to test it.'),
      );
    }
  }

  /** Stops the test and releases the microphone. */
  private stop(): void {
    clearInterval(this.timer);
    this.stream?.getTracks().forEach(function (t) {
      return t.stop();
    });
    void this.ctx?.close();
    this.stream = null;
    this.ctx = null;
    this.testing.set(false);
    this.level.set(0);
  }

  /** The level of a signal in decibels, for the meter. */
  protected dbfs(level: number): string {
    return decibels(level);
  }

  /** Stops the test when the page goes away. */
  ngOnDestroy(): void {
    this.stop();
  }
}
