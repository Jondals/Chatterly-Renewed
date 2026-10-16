/*
 * mobile/android/app/src/main/java/app/chatterly/renewed/ScreenForegroundService.java
 * Captures the screen while the person shares it in a call, and hands each picture to the page as a JPEG.
 *
 * * Why a service: since Android 10 a screen capture (MediaProjection) must run inside a foreground service of type
 *   "mediaProjection", started after the person accepted the system dialog. The Android WebView has no getDisplayMedia,
 *   so the pictures travel to the page, which draws them on a canvas and sends that canvas to the call as a video.
 * ! Only while sharing (started by ScreenSharePlugin, stopped when the person stops, when the system ends the capture
 *   or when the call ends). Not exported. Its notification is generic, like the one of the call. The pictures are sent
 *   only to the listener the plugin registered (the page of the app), never written to a file or the network here.
 * * Pace: at most one picture in flight. The page acknowledges each one (ScreenSharePlugin.ack); until then no new
 *   picture is encoded, so a slow phone or a slow page never piles up pictures in memory.
 * * Turning the phone: the virtual screen follows the orientation (it is resized when the display rotates); before, a
 *   landscape game was squeezed into a portrait picture and looked tiny.
 * * Sound (Android 10+, when the person asks for it): the sound that other apps play (media, games) is captured with
 *   AudioPlaybackCapture and sent to the page as 16-bit PCM, mono, 48 kHz, in pieces of 100 ms. ! The sound of this app
 *   (the voices of the call, the soundboard) is excluded, so the others never hear themselves back.
 */
package app.chatterly.renewed;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.Manifest;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.Point;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Process;
import android.util.DisplayMetrics;
import android.view.Display;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.concurrent.atomic.AtomicBoolean;

public class ScreenForegroundService extends Service {

    /** Who receives the pictures and the end of the capture (the plugin; null when the page is gone). */
    interface Listener {
        /** A picture: a JPEG of the given size (the array is the listener's to keep). */
        void onFrame(byte[] jpeg, int width, int height);

        void onStopped();

        /** A piece of the shared sound: 16-bit PCM, mono, 48 kHz, little endian (the array is the listener's to keep). */
        void onAudio(byte[] pcm);

        /** The sound comes as pure silence for a few seconds: the apps on screen do not let their sound be captured. */
        void onSilent();
    }

    /** The channel of the notification while the screen is shared (quiet). */
    static final String CHANNEL_ID = "screen";
    private static final int NOTIFICATION_ID = 1002;

    static final String EXTRA_RESULT_CODE = "resultCode";
    static final String EXTRA_PROJECTION = "projection";
    static final String EXTRA_LONG_SIDE = "longSide";
    static final String EXTRA_FPS = "fps";
    static final String EXTRA_QUALITY = "quality";
    static final String EXTRA_AUDIO = "audio";

    /** The sound sent to the page: mono, 48 kHz, 16-bit, in pieces of 50 ms (smaller pieces: less delay, steadier playing). */
    private static final int AUDIO_RATE = 48000;
    private static final int AUDIO_PIECE = AUDIO_RATE / 20;
    /** How many pieces of pure silence in a row mean "this sound cannot be captured" (4 s). */
    private static final int SILENT_PIECES = 80;

    /** The plugin that listens. Static because a service has no other way to know it; set before the service starts. */
    static volatile Listener listener;
    /** The service that is running now (so the plugin can acknowledge pictures and stop it). */
    private static volatile ScreenForegroundService running;

    private final AtomicBoolean waitingForAck = new AtomicBoolean(false);
    private final AtomicBoolean stopping = new AtomicBoolean(false);
    private MediaProjection projection;
    private VirtualDisplay display;
    private ImageReader reader;
    private HandlerThread thread;
    private Handler handler;
    private long lastFrameAt;
    private long minGapMs = 100;
    private int jpegQuality = 60;
    /** The quality the page asked for: the one the encoder goes back to when the phone has room again. */
    private int baseQuality = 60;
    /** How many pictures in a row took longer to make than the pace allows (or much less): the quality follows it. */
    private int slowStreak = 0;
    private int fastStreak = 0;
    private Bitmap padded;
    private int longSide = 1280;
    private int frameWidth;
    private int frameHeight;
    private DisplayManager displays;
    private AudioRecord audio;
    private Thread audioThread;

    /** The display turned (or changed size): the virtual screen and the reader follow it. */
    private final DisplayManager.DisplayListener rotation = new DisplayManager.DisplayListener() {
        @Override
        public void onDisplayAdded(int displayId) {}

        @Override
        public void onDisplayRemoved(int displayId) {}

        @Override
        public void onDisplayChanged(int displayId) {
            if (displayId == Display.DEFAULT_DISPLAY) {
                followDisplay();
            }
        }
    };

    /** True while a capture is running. */
    static boolean isRunning() {
        return running != null;
    }

    /** The page has drawn the last picture: the next one may be encoded. */
    static void acknowledge() {
        ScreenForegroundService service = running;
        if (service != null) {
            service.waitingForAck.set(false);
        }
    }

    /** Ends the capture (the person stopped sharing, or the call ended). */
    static void stopCapture(Context context) {
        context.stopService(new Intent(context, ScreenForegroundService.class));
    }

    /** Nothing binds to this service: it only runs. */
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /** Goes to the foreground, takes the projection the person allowed and starts reading the screen. */
    @Override
    @SuppressWarnings("deprecation")
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || running != null) {
            // Not a capture of its own: nothing to free, and the capture that runs must not be reported as stopped.
            stopping.set(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        createChannel(this);
        try {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                buildNotification(),
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION : 0
            );
        } catch (RuntimeException refused) {
            finish();
            return START_NOT_STICKY;
        }
        Intent grant = intent.getParcelableExtra(EXTRA_PROJECTION);
        int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
        longSide = Math.max(480, Math.min(1920, intent.getIntExtra(EXTRA_LONG_SIDE, 1280)));
        boolean withSound = intent.getBooleanExtra(EXTRA_AUDIO, false);
        int fps = Math.max(1, Math.min(60, intent.getIntExtra(EXTRA_FPS, 30)));
        jpegQuality = Math.max(30, Math.min(90, intent.getIntExtra(EXTRA_QUALITY, 60)));
        baseQuality = jpegQuality;
        // A little less than the exact gap: the pictures of a 60 Hz screen arrive a millisecond early or late, and 60 would become 30.
        minGapMs = Math.max(1L, 1000L / fps - 2L);
        if (grant == null) {
            finish();
            return START_NOT_STICKY;
        }
        try {
            MediaProjectionManager manager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            projection = manager.getMediaProjection(resultCode, grant);
            if (projection == null) {
                finish();
                return START_NOT_STICKY;
            }
            running = this;
            thread = new HandlerThread("chatterly-screen");
            thread.start();
            handler = new Handler(thread.getLooper());
            // ! Android 14 requires a callback registered before the capture starts; it also tells when the system ends it
            //   (the person taps "stop" in the status bar chip).
            projection.registerCallback(
                new MediaProjection.Callback() {
                    @Override
                    public void onStop() {
                        finish();
                    }
                },
                handler
            );
            startReading();
            displays = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
            if (displays != null) {
                displays.registerDisplayListener(rotation, handler);
            }
            if (withSound) {
                startSound();
            }
        } catch (RuntimeException failed) {
            finish();
        }
        return START_NOT_STICKY;
    }

    /** The size of the screen now (it changes when the phone turns), scaled to the long side the page asked for. */
    @SuppressWarnings("deprecation")
    private int[] pictureSize() {
        Point real = new Point();
        DisplayManager manager = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
        Display screen = manager == null ? null : manager.getDisplay(Display.DEFAULT_DISPLAY);
        if (screen != null) {
            screen.getRealSize(real);
        } else {
            DisplayMetrics metrics = getResources().getDisplayMetrics();
            real.set(metrics.widthPixels, metrics.heightPixels);
        }
        int realWidth = Math.max(1, real.x);
        int realHeight = Math.max(1, real.y);
        double scale = Math.min(1.0, (double) longSide / Math.max(realWidth, realHeight));
        // Even sizes: some encoders refuse odd ones, and it keeps the picture sharp.
        int width = Math.max(2, ((int) Math.round(realWidth * scale)) & ~1);
        int height = Math.max(2, ((int) Math.round(realHeight * scale)) & ~1);
        return new int[] { width, height };
    }

    /** A reader of pictures of the given size. */
    private ImageReader newReader(int width, int height) {
        ImageReader next = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
        next.setOnImageAvailableListener(
            new ImageReader.OnImageAvailableListener() {
                @Override
                public void onImageAvailable(ImageReader source) {
                    readPicture(source, width, height);
                }
            },
            handler
        );
        return next;
    }

    /** Creates the virtual screen at the size of the screen now and the reader of its pictures. */
    private void startReading() {
        int[] size = pictureSize();
        frameWidth = size[0];
        frameHeight = size[1];
        reader = newReader(frameWidth, frameHeight);
        display = projection.createVirtualDisplay(
            "chatterly-screen",
            frameWidth,
            frameHeight,
            getResources().getDisplayMetrics().densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.getSurface(),
            null,
            handler
        );
    }

    /** The phone turned: the virtual screen takes the new size (landscape or portrait) and a reader of that size. */
    private void followDisplay() {
        if (display == null || stopping.get()) {
            return;
        }
        int[] size = pictureSize();
        if (size[0] == frameWidth && size[1] == frameHeight) {
            return;
        }
        ImageReader old = reader;
        frameWidth = size[0];
        frameHeight = size[1];
        reader = newReader(frameWidth, frameHeight);
        display.resize(frameWidth, frameHeight, getResources().getDisplayMetrics().densityDpi);
        display.setSurface(reader.getSurface());
        if (old != null) {
            old.setOnImageAvailableListener(null, null);
            old.close();
        }
        // A picture of the old size may still be waiting for its acknowledgement: the new size must not wait for it.
        waitingForAck.set(false);
    }

    /** Captures the sound that other apps play (not this app) and sends it to the page in pieces of 100 ms. */
    private void startSound() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        try {
            AudioPlaybackCaptureConfiguration config = new AudioPlaybackCaptureConfiguration.Builder(projection)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                .excludeUid(Process.myUid())
                .build();
            AudioFormat format = new AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(AUDIO_RATE)
                .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                .build();
            int minimum = AudioRecord.getMinBufferSize(AUDIO_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            audio = new AudioRecord.Builder()
                .setAudioFormat(format)
                .setBufferSizeInBytes(Math.max(minimum, AUDIO_PIECE * 2 * 4))
                .setAudioPlaybackCaptureConfig(config)
                .build();
            audio.startRecording();
        } catch (RuntimeException refused) {
            // No sound: the screen is still shared.
            audio = null;
            return;
        }
        AudioRecord recorder = audio;
        audioThread = new Thread(
            new Runnable() {
                @Override
                public void run() {
                    readSound(recorder);
                }
            },
            "chatterly-screen-sound"
        );
        audioThread.start();
    }

    /** Reads the sound until the capture ends and hands each piece to the page. */
    private void readSound(AudioRecord recorder) {
        byte[] piece = new byte[AUDIO_PIECE * 2];
        int silent = 0;
        boolean told = false;
        while (!stopping.get()) {
            int filled = 0;
            while (filled < piece.length && !stopping.get()) {
                int read = recorder.read(piece, filled, piece.length - filled);
                if (read <= 0) {
                    return;
                }
                filled += read;
            }
            Listener target = listener;
            if (target != null && filled == piece.length) {
                boolean quiet = true;
                for (int i = 0; i < piece.length && quiet; i++) {
                    quiet = piece[i] == 0;
                }
                silent = quiet ? silent + 1 : 0;
                if (silent >= SILENT_PIECES && !told) {
                    told = true;
                    target.onSilent();
                }
                if (!quiet) {
                    told = false;
                }
                target.onAudio(piece.clone());
            }
        }
    }

    /** Takes the newest picture; encodes it only if the page is ready for one and the pace allows it. */
    private void readPicture(ImageReader source, int width, int height) {
        Image image = null;
        try {
            image = source.acquireLatestImage();
            if (image == null) {
                return;
            }
            long now = System.currentTimeMillis();
            Listener target = listener;
            if (target == null || waitingForAck.get() || now - lastFrameAt < minGapMs) {
                return;
            }
            Image.Plane plane = image.getPlanes()[0];
            ByteBuffer pixels = plane.getBuffer();
            int pixelStride = plane.getPixelStride();
            int rowPadding = plane.getRowStride() - pixelStride * width;
            int paddedWidth = width + rowPadding / pixelStride;
            if (padded == null || padded.getWidth() != paddedWidth || padded.getHeight() != height) {
                padded = Bitmap.createBitmap(paddedWidth, height, Bitmap.Config.ARGB_8888);
            }
            padded.copyPixelsFromBuffer(pixels);
            Bitmap picture = paddedWidth == width ? padded : Bitmap.createBitmap(padded, 0, 0, width, height);
            ByteArrayOutputStream bytes = new ByteArrayOutputStream(64 * 1024);
            picture.compress(Bitmap.CompressFormat.JPEG, jpegQuality, bytes);
            if (picture != padded) {
                picture.recycle();
            }
            adaptQuality(System.currentTimeMillis() - now);
            lastFrameAt = now;
            waitingForAck.set(true);
            target.onFrame(bytes.toByteArray(), width, height);
        } catch (RuntimeException skipped) {
            // A picture that cannot be read is skipped; the next one comes in a moment.
        } finally {
            if (image != null) {
                image.close();
            }
        }
    }

    /**
     * A phone that cannot make the pictures as fast as the pace asks makes them lighter (a lower JPEG quality takes less time to
     * encode and to send and decode), and goes back up when it has room again. Without this a slow phone sent few, heavy pictures.
     */
    private void adaptQuality(long encodeMs) {
        if (encodeMs > minGapMs + minGapMs / 5) {
            fastStreak = 0;
            if (++slowStreak >= 6 && jpegQuality > 36) {
                jpegQuality = Math.max(36, jpegQuality - 6);
                slowStreak = 0;
            }
        } else if (encodeMs < minGapMs / 2) {
            slowStreak = 0;
            if (++fastStreak >= 90 && jpegQuality < baseQuality) {
                jpegQuality = Math.min(baseQuality, jpegQuality + 4);
                fastStreak = 0;
            }
        } else {
            slowStreak = 0;
            fastStreak = 0;
        }
    }

    /** Ends the capture once (the person stopped, the system ended it or something failed) and tells the page. */
    private void finish() {
        if (!stopping.compareAndSet(false, true)) {
            return;
        }
        Listener target = listener;
        if (displays != null) {
            displays.unregisterDisplayListener(rotation);
            displays = null;
        }
        if (audio != null) {
            try {
                audio.stop();
            } catch (IllegalStateException alreadyStopped) {
                // Nothing to stop.
            }
            // The reading thread leaves its loop once the recording stops; it must be out before the recorder is freed.
            if (audioThread != null) {
                try {
                    audioThread.join(500);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                }
                audioThread = null;
            }
            audio.release();
            audio = null;
        }
        if (display != null) {
            display.release();
            display = null;
        }
        if (reader != null) {
            reader.setOnImageAvailableListener(null, null);
            reader.close();
            reader = null;
        }
        if (projection != null) {
            projection.stop();
            projection = null;
        }
        if (thread != null) {
            thread.quitSafely();
            thread = null;
        }
        if (padded != null) {
            padded.recycle();
            padded = null;
        }
        if (running == this) {
            running = null;
        }
        if (target != null) {
            target.onStopped();
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    /** Stopped from outside (the plugin) or by the system: free everything. */
    @Override
    public void onDestroy() {
        finish();
        super.onDestroy();
    }

    /** The notification: the name of the app and "Sharing the screen", and a tap opens the app. */
    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.screen_in_progress))
            .setSmallIcon(R.mipmap.ic_launcher)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(tap)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    /** Creates the quiet channel once (Android 8 and later need a channel for every notification). */
    static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.screen_channel_name),
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setShowBadge(false);
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }
}
