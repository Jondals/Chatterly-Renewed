/*
 * mobile/android/app/src/main/java/app/chatterly/renewed/MainActivity.java
 * The only screen of the Android app: Capacitor's WebView with the web app that is packed inside the APK.
 *
 * ! FLAG_SECURE is on from the first frame: no screenshots or screen recordings of the app, and the screen of recent
 *   apps shows a blank card instead of the last conversation. (A setting to turn it off comes with the native bridge.)
 * * The back key goes back inside the app (closing settings, returning from the registration page...) and only on the
 *   first page leaves it to Android, which sends the app to the background. Capacitor itself (without its App plugin,
 *   which this app does not carry) does not handle the back key. Checked on the emulator with a real tap.
 */
package app.chatterly.renewed;

import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Protects the window before anything is drawn, registers the call plugin, lets Capacitor start the WebView and then
     * puts the stricter client in place (only the app may ask for the microphone and the camera; see
     * SecureWebChromeClient) and the back key of the app.
     */
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        // The only native plugin of the app: keep a call alive in the background (see CallServicePlugin).
        registerPlugin(CallServicePlugin.class);
        super.onCreate(savedInstanceState);
        getBridge().getWebView().setWebChromeClient(new SecureWebChromeClient(getBridge()));
        getOnBackPressedDispatcher().addCallback(this, new WebHistoryBack());
    }

    /** The back key: one step back in the history of the app, or out of the app on its first page. */
    private final class WebHistoryBack extends OnBackPressedCallback {

        /** Starts enabled: it decides every press of the back key. */
        WebHistoryBack() {
            super(true);
        }

        /** Goes back inside the app when it can; otherwise lets Android do its default (to the background). */
        @Override
        public void handleOnBackPressed() {
            WebView view = getBridge().getWebView();
            if (view != null && view.canGoBack()) {
                view.goBack();
                return;
            }
            setEnabled(false);
            getOnBackPressedDispatcher().onBackPressed();
            setEnabled(true);
        }
    }
}
