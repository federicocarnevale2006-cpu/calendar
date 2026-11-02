// Tutte le prove dell'app (npm test). Su GitHub girano prima di compilare: se una fallisce, APK ed exe non escono.
const tests = ["t_base", "t_pages", "t_sync", "t_multi"];
(async () => {
  let ok = true;
  for (const t of tests) {
    try { ok = (await require("./" + t + ".cjs")()) && ok; } catch (e) { ok = false; console.log(`ERR [${t}] si e' fermata: ${e && e.stack || e}`); }
  }
  console.log(ok ? "\nTUTTE LE PROVE OK" : "\nALCUNE PROVE NON SONO PASSATE");
  process.exit(ok ? 0 : 1);
})();
