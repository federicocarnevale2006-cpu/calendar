package app.trofeo.calendario;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Sveglia del prossimo promemoria: mostra la notifica e programma il successivo (vedi {@link CalReminders}). */
public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        final PendingResult pr = goAsync();
        final Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                CalReminders.fire(app);
            } catch (Exception ignored) {
            } finally {
                pr.finish();
            }
        }).start();
    }
}
