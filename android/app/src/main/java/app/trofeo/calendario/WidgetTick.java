package app.trofeo.calendario;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Sveglia di mezzanotte (e riavvio del telefono): i widget passano al giorno nuovo. */
public class WidgetTick extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        CalWidgets.refreshAsync(context, goAsync(), true);
    }
}
