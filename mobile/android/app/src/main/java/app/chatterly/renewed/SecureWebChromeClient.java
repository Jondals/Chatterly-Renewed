/*
 * mobile/android/app/src/main/java/app/chatterly/renewed/SecureWebChromeClient.java
 * Narrows what the WebView may be given, on top of Capacitor's own client.
 *
 * ! Capacitor (8.5.2, BridgeWebChromeClient.onPermissionRequest) grants the camera and the microphone to whatever page
 *   asks, without looking at its origin, and grants any other resource (protected media ids, MIDI...) without asking at
 *   all. The CSP already forbids frames and the WebView cannot navigate away, so only the app runs here; this class
 *   makes that a rule of the native side too:
 *     - only the app itself (its own https origin) may ask, and only for the microphone and the camera;
 *     - the location is always refused (the app never needs it, and no location permission is declared).
 */
package app.chatterly.renewed;

import android.net.Uri;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

public class SecureWebChromeClient extends BridgeWebChromeClient {

    /** The only resources a page may ask for: what a call needs. */
    private static final String[] ALLOWED_RESOURCES = {
        PermissionRequest.RESOURCE_AUDIO_CAPTURE,
        PermissionRequest.RESOURCE_VIDEO_CAPTURE,
    };

    /** The origin of the app inside the APK (for example https://chatterly.internal). */
    private final Uri appOrigin;

    /** Wraps Capacitor's client; the origin of the app is taken from the bridge. */
    public SecureWebChromeClient(Bridge bridge) {
        super(bridge);
        this.appOrigin = Uri.parse(bridge.getLocalUrl());
    }

    /** Lets the request through to Capacitor only when it comes from the app and asks only for audio and video. */
    @Override
    public void onPermissionRequest(PermissionRequest request) {
        if (!isAppOrigin(request.getOrigin()) || !onlyAllowedResources(request.getResources())) {
            request.deny();
            return;
        }
        super.onPermissionRequest(request);
    }

    /** The location is never given to a page. */
    @Override
    public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
        callback.invoke(origin, false, false);
    }

    /** True when the address has exactly the scheme, host and port of the app. */
    private boolean isAppOrigin(Uri origin) {
        return origin != null
            && appOrigin.getScheme() != null
            && appOrigin.getScheme().equals(origin.getScheme())
            && appOrigin.getHost() != null
            && appOrigin.getHost().equals(origin.getHost())
            && appOrigin.getPort() == origin.getPort();
    }

    /** True when every resource asked is one of the allowed ones (and at least one is asked). */
    private static boolean onlyAllowedResources(String[] resources) {
        if (resources == null || resources.length == 0) {
            return false;
        }
        for (String resource : resources) {
            boolean known = false;
            for (String allowed : ALLOWED_RESOURCES) {
                if (allowed.equals(resource)) {
                    known = true;
                    break;
                }
            }
            if (!known) {
                return false;
            }
        }
        return true;
    }
}
