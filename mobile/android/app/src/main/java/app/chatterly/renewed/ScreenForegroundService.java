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
 */
package app.chatterly.renewed;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.Base64;
import android.util.DisplayMetrics;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.concurrent.atomic.AtomicBoolean;

public class ScreenForegroundService extends Service {

    /** Who receives the pictures and the end of the capture (the plugin; null when the page is gone). */
    interface Listener {
        void onFrame(String jpegBase64, int width, int height);

        void onStopped();
    }

    /** The channel of the notification while the screen is shared (quiet). */
    static final String CHANNEL_ID = "screen";
    private static final int NOTIFICATION_ID = 1002;

    static final String EXTRA_RESULT_CODE = "resultCode";
    static final String EXTRA_PROJECTION = "projection";
    static final String EXTRA_LONG_SIDE = "longSide";
    static final String EXTRA_FPS = "fps";
    static final String EXTRA_QUALITY = "quality";

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
    private Bitmap padded;

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
        int longSide = Math.max(480, Math.min(1920, intent.getIntExtra(EXTRA_LONG_SIDE, 1280)));
        int fps = Math.max(1, Math.min(30, intent.getIntExtra(EXTRA_FPS, 12)));
        jpegQuality = Math.max(30, Math.min(90, intent.getIntExtra(EXTRA_QUALITY, 60)));
        minGapMs = 1000L / fps;
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
            startReading(longSide);
        } catch (RuntimeException failed) {
            finish();
        }
        return START_NOT_STICKY;
    }

    /** Creates the virtual screen at the size the page asked for and the reader of its pictures. */
    private void startReading(int longSide) {
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        int realWidth = Math.max(1, metrics.widthPixels);
        int realHeight = Math.max(1, metrics.heightPixels);
        double scale = Math.min(1.0, (double) longSide / Math.max(realWidth, realHeight));
        // Even sizes: some encoders refuse odd ones, and it keeps the picture sharp.
        int width = Math.max(2, ((int) Math.round(realWidth * scale)) & ~1);
        int height = Math.max(2, ((int) Math.round(realHeight * scale)) & ~1);
        reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
        reader.setOnImageAvailableListener(
            new ImageReader.OnImageAvailableListener() {
                @Override
                public void onImageAvailable(ImageReader source) {
                    readPicture(source, width, height);
                }
            },
            handler
        );
        display = projection.createVirtualDisplay(
            "chatterly-screen",
            width,
            height,
            metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.getSurface(),
            null,
            handler
        );
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
            lastFrameAt = now;
            waitingForAck.set(true);
            target.onFrame(Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP), width, height);
        } catch (RuntimeException skipped) {
            // A picture that cannot be read is skipped; the next one comes in a moment.
        } finally {
            if (image != null) {
                image.close();
            }
        }
    }

    /** Ends the capture once (the person stopped, the system ended it or something failed) and tells the page. */
    private void finish() {
        if (!stopping.compareAndSet(false, true)) {
            return;
        }
        Listener target = listener;
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
