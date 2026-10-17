(function () {
  "use strict";
  if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
  const SERVICE_WORKER_URL = "./service-worker.js?v=0.2.4";
  const hadControllerAtStartup = Boolean(navigator.serviceWorker.controller);
  let reloadingForUpdate = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadControllerAtStartup || reloadingForUpdate) return;
    reloadingForUpdate = true;
    location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, { updateViaCache: "none" });
      const checkForUpdate = () => registration.update().catch(() => {});
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) worker.postMessage({ type: "SKIP_WAITING" });
        });
      });
      window.addEventListener("pageshow", checkForUpdate);
      window.addEventListener("online", checkForUpdate);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") checkForUpdate();
      });
      window.setInterval(checkForUpdate, 30 * 60 * 1000);
      checkForUpdate();
    } catch {
      // オフラインでもローカル保存済みのListoはそのまま利用できる。
    }
  });
})();
