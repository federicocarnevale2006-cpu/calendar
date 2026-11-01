package app.trofeo.calendario;

import android.app.job.JobParameters;
import android.app.job.JobService;

/**
 * Ogni 30 minuti (con la rete) rilegge gli eventi dal server: widget e promemoria si aggiornano anche ad app chiusa
 * (eventi aggiunti dal PC o dalla mail dei turni).
 */
public class FetchJob extends JobService {
    @Override
    public boolean onStartJob(final JobParameters params) {
        new Thread(() -> {
            try {
                CalWidgets.prefs(getApplicationContext()).edit()
                        .putLong("fetched", Math.min(CalWidgets.prefs(getApplicationContext()).getLong("fetched", 0),
                                System.currentTimeMillis() - 21L * 60000L)).apply();   // lettura subito
                CalWidgets.maybeFetch(getApplicationContext());
                CalWidgets.updateAll(getApplicationContext());
                CalReminders.reschedule(getApplicationContext());
            } catch (Exception ignored) {
            }
            jobFinished(params, false);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }
}
