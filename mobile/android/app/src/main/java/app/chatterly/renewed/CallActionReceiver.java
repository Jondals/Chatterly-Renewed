/*
 * mobile/android/app/src/main/java/app/chatterly/renewed/CallActionReceiver.java
 * Hears the "Decline" button of the notification of a call that rings, and tells the page.
 *
 * ! Not exported: only the PendingIntent of this app's own notification can reach it.
 */
package app.chatterly.renewed;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class CallActionReceiver extends BroadcastReceiver {

    /** The action of the Decline button. */
    static final String ACTION_DECLINE = "app.chatterly.renewed.call.DECLINE";

    /** Takes the notification away and tells the page that the person declined. */
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_DECLINE.equals(intent.getAction())) {
            return;
        }
        IncomingCallNotifier.cancel(context);
        CallServicePlugin.deliver("decline", intent.getStringExtra(MainActivity.EXTRA_ROOM));
    }
}
