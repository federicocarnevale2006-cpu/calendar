package app.trofeo.calendario;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;

/** Widget «Mese» della schermata Home. */
public class MonthWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
        CalWidgets.refreshAsync(context, goAsync(), true);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager mgr, int id, Bundle options) {
        CalWidgets.refreshAsync(context, goAsync(), false);          // ridimensionato: si ridisegna alla misura nuova
    }
}
