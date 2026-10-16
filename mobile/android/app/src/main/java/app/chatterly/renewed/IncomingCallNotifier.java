/*
 * mobile/android/app/src/main/java/app/chatterly/renewed/IncomingCallNotifier.java
 * The notification of a call that rings while the app is not on screen: it pops up over other apps (or fills the
 * screen when the phone is locked), rings with the ringtone of the phone and has two buttons, Answer and Decline.
 *
 * * Answer opens the app with the call (MainActivity hands it to the page, which joins). Decline goes to
 *   CallActionReceiver (not exported) and the page stops ringing. The notification goes away by itself after 45 s,
 *   like the ringing of the page.
 * ! The lock screen shows the generic version ("Incoming call"): the name of who calls appears only once unlocked.
 *   The id of the call travels only inside this app's own intents.
 */
package app.chatterly.renewed;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;

final class IncomingCallNotifier {

    /** The channel of incoming calls: urgent, with the ringtone of the phone. */
    static final String CHANNEL_ID = "incoming_calls_v1";
    /** The id of the notification (one ringing call at a time, like the page). */
    static final int NOTIFICATION_ID = 1003;
    /** How long a call rings before the notification goes away by itself. */
    private static final long RING_MS = 45_000;

    private IncomingCallNotifier() {}

    /** Shows (or replaces) the notification of a call that rings. */
    static void show(Context context, String roomId, String caller) {
        createChannel(context);
        String name = caller == null || caller.isEmpty() ? context.getString(R.string.incoming_call) : caller;
        Intent answer = new Intent(context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra(MainActivity.EXTRA_CALL_ACTION, "answer")
            .putExtra(MainActivity.EXTRA_ROOM, roomId);
        Intent open = new Intent(context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra(MainActivity.EXTRA_CALL_ACTION, "ringing")
            .putExtra(MainActivity.EXTRA_ROOM, roomId);
        Intent decline = new Intent(context, CallActionReceiver.class)
            .setAction(CallActionReceiver.ACTION_DECLINE)
            .putExtra(MainActivity.EXTRA_ROOM, roomId);
        int flags = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent answerIntent = PendingIntent.getActivity(context, 21, answer, flags);
        PendingIntent openIntent = PendingIntent.getActivity(context, 22, open, flags);
        PendingIntent declineIntent = PendingIntent.getBroadcast(context, 23, decline, flags);
        Person person = new Person.Builder().setName(name).setImportant(true).build();
        Notification generic = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(context.getString(R.string.incoming_call))
            .setSmallIcon(R.drawable.ic_stat_chatterly)
            .build();
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_chatterly)
            .setColor(0xFF2EF2B0)
            .setContentTitle(name)
            .setContentText(context.getString(R.string.incoming_call))
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setAutoCancel(true)
            .setTimeoutAfter(RING_MS)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(generic)
            .setContentIntent(openIntent)
            .setFullScreenIntent(openIntent, true)
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(person, declineIntent, answerIntent));
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build());
        } catch (SecurityException noPermission) {
            // The person did not allow notifications: the page still rings when it is opened.
        }
    }

    /** Takes the notification away (answered, declined, or the call ended). */
    static void cancel(Context context) {
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID);
    }

    /** Creates the urgent channel once, with the ringtone of the phone and vibration. */
    private static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.incoming_channel_name),
            NotificationManager.IMPORTANCE_HIGH
        );
        AudioAttributes ring = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), ring);
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] { 0, 800, 600, 800, 600 });
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }
}
