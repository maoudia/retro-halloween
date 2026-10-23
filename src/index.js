// Retro Halloween - un seul Worker: fichiers statiques (public/) + synchro temps reel (Durable Object).
// Aucun console.log volontaire: le code n'ecrit rien dans les logs.
import { DurableObject } from "cloudflare:workers";

const ROOM_RE = /^[A-Za-z0-9_-]{22,64}$/;
const CID_RE = /^[A-Za-z0-9_-]{16,40}$/;
const COLS = ["citrouilles", "fantomes", "toiles", "potions", "bonbons"];
const MAX_NOTES = 300;
const MAX_ACTIONS = 100;
const MAX_CONN = 30;
const MAX_VOTES = 3;
const MAX_MSG = 4096;
const TTL_MS = 24 * 60 * 60 * 1000; // la room est effacee 24 h apres la derniere activite

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' wss:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-cache",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
      // Une page d'un autre site ne peut pas ouvrir la connexion.
      try {
        const origin = request.headers.get("Origin");
        if (!origin || new URL(origin).host !== url.host) return new Response("Forbidden", { status: 403 });
      } catch {
        return new Response("Forbidden", { status: 403 });
      }
      const room = url.searchParams.get("room") || "";
      if (!ROOM_RE.test(room)) return new Response("Bad room", { status: 400 });
      const stub = env.ROOM.get(env.ROOM.idFromName(room));
      return stub.fetch(request);
    }

    const res = await env.ASSETS.fetch(request);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  },
};

const clean = (s, max) =>
  typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.notes = new Map(); // id -> {id, col, text, ts, cid, author}
    this.votes = new Set(); // "cid:noteId"
    this.actions = new Map(); // id -> {id, text, owner, done, ts}
    this.timer = { running: false, endsAt: 0, remaining: 300000 };
    this.rate = new WeakMap();
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.ctx.blockConcurrencyWhile(async () => {
      const all = await this.ctx.storage.list();
      for (const [k, v] of all) {
        if (k.startsWith("n:")) this.notes.set(k.slice(2), v);
        else if (k.startsWith("v:")) this.votes.add(k.slice(2));
        else if (k.startsWith("a:")) this.actions.set(k.slice(2), v);
        else if (k === "timer") this.timer = v;
      }
    });
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    if (this.ctx.getWebSockets().length >= MAX_CONN) return new Response("Room full", { status: 503 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ cid: null, name: "", showName: false });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > MAX_MSG) {
      try { ws.close(1009, "too big"); } catch {}
      return;
    }
    const now = Date.now();
    const r = this.rate.get(ws) || { n: 0, start: now };
    if (now - r.start > 10000) { r.n = 0; r.start = now; }
    r.n += 1;
    this.rate.set(ws, r);
    if (r.n > 40) return;

    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== "object") return;

    const att = ws.deserializeAttachment() || {};

    if (m.t === "hello") {
      if (!CID_RE.test(m.cid || "")) return;
      const next = { cid: m.cid, name: clean(m.name, 24), showName: m.showName === true };
      ws.serializeAttachment(next);
      this.broadcast();
      return;
    }
    if (!att.cid) return;

    switch (m.t) {
      case "note": {
        const text = clean(m.text, 280);
        if (!text || !COLS.includes(m.col) || this.notes.size >= MAX_NOTES) return;
        const id = crypto.randomUUID();
        const note = { id, col: m.col, text, ts: now, cid: att.cid, author: m.author === true && att.showName ? att.name : "" };
        this.notes.set(id, note);
        await this.ctx.storage.put("n:" + id, note);
        break;
      }
      case "del": {
        const n = this.notes.get(m.id);
        if (!n || n.cid !== att.cid) return;
        this.notes.delete(m.id);
        const keys = ["n:" + m.id];
        for (const v of [...this.votes]) {
          if (v.endsWith(":" + m.id)) { this.votes.delete(v); keys.push("v:" + v); }
        }
        await this.ctx.storage.delete(keys);
        break;
      }
      case "vote": {
        if (!this.notes.has(m.id)) return;
        const key = att.cid + ":" + m.id;
        if (this.votes.has(key)) {
          this.votes.delete(key);
          await this.ctx.storage.delete("v:" + key);
        } else {
          let mine = 0;
          for (const v of this.votes) if (v.startsWith(att.cid + ":")) mine += 1;
          if (mine >= MAX_VOTES) return;
          this.votes.add(key);
          await this.ctx.storage.put("v:" + key, 1);
        }
        break;
      }
      case "act": {
        const text = clean(m.text, 200);
        if (!text || this.actions.size >= MAX_ACTIONS) return;
        const id = crypto.randomUUID();
        const a = { id, text, owner: clean(m.owner, 40), done: false, ts: now };
        this.actions.set(id, a);
        await this.ctx.storage.put("a:" + id, a);
        break;
      }
      case "actDone": {
        const a = this.actions.get(m.id);
        if (!a) return;
        a.done = m.done === true;
        await this.ctx.storage.put("a:" + m.id, a);
        break;
      }
      case "actDel": {
        if (!this.actions.delete(m.id)) return;
        await this.ctx.storage.delete("a:" + m.id);
        break;
      }
      case "reset": {
        // Efface tout le board pour tout le monde (les brouillons prives restent chez chacun).
        this.notes.clear();
        this.votes.clear();
        this.actions.clear();
        this.timer = { running: false, endsAt: 0, remaining: 300000 };
        await this.ctx.storage.deleteAll();
        break;
      }
      case "timer": {
        const t = this.timer;
        if (m.op === "start" && !t.running) {
          const ms = t.remaining > 0 ? t.remaining : 300000;
          this.timer = { running: true, endsAt: now + ms, remaining: ms };
        } else if (m.op === "pause" && t.running) {
          this.timer = { running: false, endsAt: 0, remaining: Math.max(0, t.endsAt - now) };
        } else if (m.op === "reset") {
          const min = Number.isInteger(m.minutes) && m.minutes >= 1 && m.minutes <= 60 ? m.minutes : 5;
          this.timer = { running: false, endsAt: 0, remaining: min * 60000 };
        } else return;
        await this.ctx.storage.put("timer", this.timer);
        break;
      }
      default:
        return;
    }
    await this.ctx.storage.setAlarm(now + TTL_MS);
    this.broadcast();
  }

  async webSocketClose(ws) {
    try { ws.close(1000, "bye"); } catch {}
    this.broadcast(ws);
  }

  async webSocketError(ws) {
    try { ws.close(1011, "error"); } catch {}
    this.broadcast(ws);
  }

  // Efface tout apres 24 h sans activite.
  async alarm() {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.close(1001, "expired"); } catch {}
    }
    this.notes.clear();
    this.votes.clear();
    this.actions.clear();
    this.timer = { running: false, endsAt: 0, remaining: 300000 };
    await this.ctx.storage.deleteAll();
  }

  snapshotFor(att, peers) {
    const counts = new Map();
    const mine = new Set();
    for (const v of this.votes) {
      const i = v.indexOf(":");
      const cid = v.slice(0, i);
      const nid = v.slice(i + 1);
      counts.set(nid, (counts.get(nid) || 0) + 1);
      if (cid === att.cid) mine.add(nid);
    }
    const notes = [...this.notes.values()]
      .sort((a, b) => a.ts - b.ts)
      .map((n) => ({
        id: n.id, col: n.col, text: n.text, ts: n.ts, author: n.author,
        mine: n.cid === att.cid, votes: counts.get(n.id) || 0, voted: mine.has(n.id),
      }));
    const actions = [...this.actions.values()].sort((a, b) => a.ts - b.ts);
    return JSON.stringify({ t: "state", now: Date.now(), notes, actions, timer: this.timer, peers });
  }

  broadcast(except) {
    const sockets = this.ctx.getWebSockets().filter((w) => w !== except);
    const seen = new Map();
    for (const w of sockets) {
      const a = w.deserializeAttachment();
      if (a && a.cid) seen.set(a.cid, a.name || "");
    }
    const peers = [...seen.values()];
    for (const w of sockets) {
      const a = w.deserializeAttachment();
      if (!a || !a.cid) continue;
      try { w.send(this.snapshotFor(a, peers)); } catch {}
    }
  }
}
