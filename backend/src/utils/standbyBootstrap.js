/*
 * Sonalit standby runtime guard.
 *
 * The legacy monolith contains several node-cron schedules inside app.js.
 * A second API container must not execute those schedules while it is a
 * standby replica, otherwise reports, intelligence sweeps, retention jobs,
 * and other side effects can run twice.
 *
 * Set SONALIT_STANDBY=true on the disaster-recovery replica. The guard makes
 * node-cron.schedule() a safe no-op for that process. Promotion is performed
 * by restarting the container with SONALIT_STANDBY=false.
 */
const Module = require("module");

if (String(process.env.SONALIT_STANDBY || "").toLowerCase() === "true") {
  const originalLoad = Module._load;

  Module._load = function standbyAwareLoad(request, parent, isMain) {
    const loaded = originalLoad.call(this, request, parent, isMain);
    if (request !== "node-cron") return loaded;

    return {
      ...loaded,
      schedule() {
        return {
          start() {},
          stop() {},
          destroy() {},
          execute() {},
        };
      },
    };
  };

  const logger = (() => {
    try { return require("./logger"); } catch (_) { return console; }
  })();

  logger.warn("SONALIT_STANDBY=true — scheduled jobs and in-process cron tasks are disabled");
}
