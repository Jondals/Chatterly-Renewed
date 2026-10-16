/**
 * src/app/features/voice/voice-route.component.ts
 * The page of the call. The call itself (VoiceStageComponent) lives in the main layout so that it keeps running
 * (music, video, Spinly, shared screens) when the person goes to another page; this route draws nothing.
 */
import { ChangeDetectionStrategy, Component } from '@angular/core';

/** An empty page: the call is drawn by the layout. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-voice-route',
  standalone: true,
  template: '',
})
export class VoiceRouteComponent {}
