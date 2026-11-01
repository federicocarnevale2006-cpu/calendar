package app.trofeo.calendario;

import android.app.job.JobParameters;
import android.app.job.JobService;

/** Lavoro di Android che invia le modifiche in attesa quando c'e' rete (anche ad app chiusa). Vedi {@link CalPush}. */
public class PushJob extends JobService {
    @Override
    public boolean onStartJob(final JobParameters params) {
        new Thread(() -> {
            int r = CalPush.RESULT_RETRY;
            try {
                r = CalPush.pushNow(getApplicationContext());
            } catch (Exception ignored) {
            }
            jobFinished(params, r == CalPush.RESULT_RETRY);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;                                                         // interrotto (rete persa): si riprova
    }
}
