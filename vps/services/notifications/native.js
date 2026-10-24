import { DatabaseSync } from "node:sqlite";
import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
let database,
  running = false;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
export function closeNativeStore() {
  database?.close();
  database = undefined;
}
function db() {
  if (database) return database;
  const root = path.resolve(
    process.env.DATA_DIR ||
      process.env.PASTQ_DATA_DIR ||
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../data"),
  );
  fs.mkdirSync(root, { recursive: true });
  database = new DatabaseSync(path.join(root, "native-notifications.db"));
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, secret TEXT NOT NULL, token TEXT NOT NULL UNIQUE, owner TEXT NOT NULL, user_id TEXT NOT NULL, platform TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS native_device_owner ON devices(owner);
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,event_id TEXT NOT NULL,device_id TEXT NOT NULL,token TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,due INTEGER NOT NULL,ticket TEXT,created_at INTEGER NOT NULL,error TEXT);
    CREATE INDEX IF NOT EXISTS native_delivery_due ON deliveries(status,due);`);
  return database;
}
export function validateDevice(input) {
  if (
    !input ||
    !/^[a-f0-9-]{36}$/i.test(input.installationId || "") ||
    !/^[a-f0-9-]{72}$/i.test(input.secret || "") ||
    !/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/.test(
      input.token || "",
    ) ||
    !["ios", "android"].includes(input.platform)
  )
    fail(
      "This device could not connect to notifications. Reopen the app and try again.",
    );
  return input;
}
export function registerDevice(owner, userId, input, now = Date.now()) {
  validateDevice(input);
  const existing = db()
    .prepare("SELECT secret,token,owner,user_id FROM devices WHERE id=?")
    .get(input.installationId);
  if (existing && existing.secret !== hash(input.secret))
    fail("This notification connection could not be verified.", 403);
  if (
    existing?.token === input.token &&
    existing.owner === owner &&
    existing.user_id === userId
  ) {
    db()
      .prepare("UPDATE devices SET updated_at=? WHERE id=?")
      .run(now, input.installationId);
    return;
  }
  // One physical push token belongs to one signed-in installation/account.
  const old = db()
    .prepare("SELECT id FROM devices WHERE token=? AND id!=?")
    .get(input.token, input.installationId);
  if (old) {
    db()
      .prepare(
        "UPDATE deliveries SET status='cancelled' WHERE device_id=? AND status IN('pending','sending','receipt')",
      )
      .run(old.id);
    db().prepare("DELETE FROM devices WHERE id=?").run(old.id);
  }
  db()
    .prepare(
      "UPDATE deliveries SET status='cancelled' WHERE device_id=? AND status IN('pending','sending','receipt')",
    )
    .run(input.installationId);
  db()
    .prepare(
      "INSERT INTO devices VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,owner=excluded.owner,user_id=excluded.user_id,platform=excluded.platform,updated_at=excluded.updated_at",
    )
    .run(
      input.installationId,
      hash(input.secret),
      input.token,
      owner,
      userId,
      input.platform,
      now,
    );
}
export function revokeDevice(input) {
  if (
    !/^[a-f0-9-]{36}$/i.test(input?.installationId || "") ||
    !/^[a-f0-9-]{72}$/i.test(input?.secret || "")
  )
    fail("Invalid device connection.");
  const existing = db()
    .prepare("SELECT secret FROM devices WHERE id=?")
    .get(input.installationId);
  if (!existing) return;
  if (
    !timingSafeEqual(
      Buffer.from(existing.secret),
      Buffer.from(hash(input.secret)),
    )
  )
    fail("Invalid device connection.", 403);
  db().prepare("DELETE FROM devices WHERE id=?").run(input.installationId);
  db()
    .prepare(
      "UPDATE deliveries SET status='cancelled' WHERE device_id=? AND status IN('pending','sending','receipt')",
    )
    .run(input.installationId);
}
export function nativeReachable(owner) {
  return Boolean(
    db().prepare("SELECT 1 FROM devices WHERE owner=? LIMIT 1").get(owner),
  );
}
// Counts only: installation secrets and device tokens never enter admin responses.
export function nativeDeviceCounts() {
  return new Map(db().prepare('SELECT owner,count(*) AS count FROM devices GROUP BY owner').all().map(row => [row.owner, row.count]));
}
export function enqueueNative(owner, eventId, content, now = Date.now()) {
  if (!owner) return { queued: 0 };
  db().exec("BEGIN IMMEDIATE");
  try {
    if (
      !db()
        .prepare("INSERT OR IGNORE INTO events VALUES(?,?)")
        .run(eventId, now).changes
    ) {
      db().exec("COMMIT");
      return { queued: 0 };
    }
    let queued = 0;
    for (const device of db()
      .prepare("SELECT * FROM devices WHERE owner=?")
      .all(owner)) {
      const payload = {
        to: device.token,
        title: content.title,
        body: content.body,
        sound: "default",
        channelId: "updates",
        ttl: 86400,
        data: { ...content.data, owner: device.user_id, eventId },
        ...(content.image
          ? { richContent: { image: content.image }, mutableContent: true }
          : {}),
      };
      if (Buffer.byteLength(JSON.stringify(payload)) > 4000)
        fail("Notification is too long.");
      db()
        .prepare(
          "INSERT INTO deliveries(id,event_id,device_id,token,payload,status,due,created_at) VALUES(?,?,?,?,?,'pending',?,?)",
        )
        .run(
          hash(eventId + ":" + device.id),
          eventId,
          device.id,
          device.token,
          JSON.stringify(payload),
          now,
          now,
        );
      queued++;
    }
    db().exec("COMMIT");
    return { queued };
  } catch (error) {
    db().exec("ROLLBACK");
    throw error;
  }
}
export function materialCompleted(session, now = Date.now()) {
  if (
    !session?.ownerKey ||
    !["completed", "completed_with_errors", "failed"].includes(session.status)
  )
    return;
  // Reconciliation never sends an old backlog after deployment or enabling push.
  if (!session.updatedAt || session.updatedAt < now - 86400000) return;
  const ready = session.status === "completed";
  return enqueueNative(
    session.ownerKey,
    "material:" + session.id,
    {
      title: ready ? "Your questions are ready" : "Your upload needs a look",
      body: ready
        ? "Your uploaded questions have finished processing. Tap to review them."
        : "Processing has finished with items to check. Tap to open your upload.",
      data: { kind: "material-ready", sessionId: session.id },
    },
    now,
  );
}
async function expoRequest(endpoint, body) {
  const response = await fetch("https://exp.host/--/api/v2/push/" + endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.EXPO_ACCESS_TOKEN
        ? { Authorization: "Bearer " + process.env.EXPO_ACCESS_TOKEN }
        : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error("Push service returned " + response.status);
  const result = await response.json();
  if (result.errors?.length) throw Error("Push service rejected this request");
  return result.data;
}
export function nativeCampaignStats(id) {
  return db()
    .prepare(
      "SELECT status,count(*) AS count FROM deliveries WHERE event_id LIKE ? GROUP BY status",
    )
    .all("campaign:" + id + ":%");
}
export function nativeCampaignRecipients(id) {
  return db()
    .prepare(
      "SELECT json_extract(payload,'$.data.owner') AS user_id,status,count(*) AS count FROM deliveries WHERE event_id LIKE ? GROUP BY user_id,status",
    )
    .all("campaign:" + id + ":%");
}
export function deliveryCounts(eventId) {
  return db()
    .prepare(
      "SELECT status,count(*) AS count FROM deliveries WHERE event_id=? GROUP BY status",
    )
    .all(eventId);
}
export async function dispatchNative({
  now = Date.now(),
  request = expoRequest,
} = {}) {
  if (running) return;
  running = true;
  function expired(row) {
    return now - row.created_at >= 86400000;
  }
  function retry(row, code) {
    const dead = code === "DeviceNotRegistered";
    if (dead)
      db()
        .prepare("DELETE FROM devices WHERE id=? AND token=?")
        .run(row.device_id, row.token);
    const terminal =
      dead ||
      ["MessageTooBig"].includes(code) ||
      row.attempts >= 8 ||
      expired(row);
    db()
      .prepare("UPDATE deliveries SET status=?,due=?,error=? WHERE id=?")
      .run(
        terminal ? "failed" : row.ticket ? "receipt" : "pending",
        now + Math.min(3600000, 30000 * 2 ** row.attempts),
        String(code || "temporary").slice(0, 80),
        row.id,
      );
  }
  try {
    db()
      .prepare(
        "UPDATE deliveries SET status='pending' WHERE status='sending' AND due<=?",
      )
      .run(now);
    const due = db()
      .prepare(
        "SELECT * FROM deliveries WHERE status IN('pending','receipt') AND due<=? ORDER BY due LIMIT 50",
      )
      .all(now);
    for (const row of due) {
      const device = db()
        .prepare("SELECT * FROM devices WHERE id=? AND token=?")
        .get(row.device_id, row.token);
      // Token transfers/account changes cancel queued payloads containing the old owner.
      if (
        !device ||
        JSON.parse(row.payload).data.owner !== device.user_id ||
        expired(row)
      ) {
        db()
          .prepare("UPDATE deliveries SET status='cancelled' WHERE id=?")
          .run(row.id);
        continue;
      }
      row.attempts++;
      db()
        .prepare("UPDATE deliveries SET attempts=? WHERE id=?")
        .run(row.attempts, row.id);
      try {
        if (row.status === "receipt") {
          const receipts = await request("getReceipts", { ids: [row.ticket] });
          const receipt = receipts?.[row.ticket];
          if (!receipt) {
            retry(row, "ReceiptPending");
            continue;
          }
          if (receipt.status === "ok") {
            db()
              .prepare(
                "UPDATE deliveries SET status='delivered',error=NULL WHERE id=?",
              )
              .run(row.id);
            continue;
          }
          // A receipt failure has not delivered a notification: retry transient provider failures.
          row.ticket = null;
          db()
            .prepare("UPDATE deliveries SET ticket=NULL WHERE id=?")
            .run(row.id);
          retry(row, receipt.details?.error || "ProviderError");
        } else {
          db()
            .prepare("UPDATE deliveries SET status='sending',due=? WHERE id=?")
            .run(now + 120000, row.id);
          const data = await request("send", [JSON.parse(row.payload)]);
          const ticket = Array.isArray(data) ? data[0] : data;
          if (ticket?.status === "ok" && ticket.id)
            db()
              .prepare(
                "UPDATE deliveries SET status='receipt',ticket=?,due=?,error=NULL WHERE id=?",
              )
              .run(ticket.id, now + 15000, row.id);
          else retry(row, ticket?.details?.error || "TicketRejected");
        }
      } catch {
        retry(row, "NetworkError");
      }
    }
    db()
      .prepare(
        "DELETE FROM deliveries WHERE created_at<? AND status NOT IN('pending','sending','receipt')",
      )
      .run(now - 30 * 86400000);
    db()
      .prepare(
        "DELETE FROM events WHERE created_at<? AND id NOT IN(SELECT event_id FROM deliveries)",
      )
      .run(now - 90 * 86400000);
  } finally {
    running = false;
  }
}
export function startNativeScheduler(reconcile = () => {}) {
  let reconciling = false;
  const tick = async () => {
    if (reconciling) return;
    reconciling = true;
    try {
      await reconcile();
      await dispatchNative();
    } catch (error) {
      console.error("[native-push]", error.message);
    } finally {
      reconciling = false;
    }
  };
  const timer = setInterval(() => void tick(), 15000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
