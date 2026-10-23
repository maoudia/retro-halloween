import WebSocket from "ws";

const BASE = process.env.BASE || "127.0.0.1:8787";
const ROOM = crypto.randomUUID().replace(/-/g, ""); // 32 caracteres, une room neuve a chaque run
const ORIGIN = `http://${BASE}`;
let failed = 0;
const ok = (c, msg) => { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(cid, name, origin = ORIGIN, room = ROOM) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${BASE}/ws?room=${room}`, { headers: { Origin: origin } });
    const c = { ws, last: null, count: 0, send: (o) => ws.send(JSON.stringify(o)) };
    ws.on("message", (d) => { const s = d.toString(); if (s === "pong") { c.pong = true; return; } c.last = JSON.parse(s); c.count++; });
    ws.on("open", () => { c.send({ t: "hello", cid, name, showName: true }); resolve(c); });
    ws.on("unexpected-response", (_req, res) => reject(new Error("HTTP " + res.statusCode)));
    ws.on("error", () => {});
  });
}

const rejectedWith = (origin, room) => client("zzzzzzzzzzzzzzzz", "x", origin, room).then(() => "open", (e) => e.message);

// 1. controles d'acces
ok((await rejectedWith("http://evil.example", ROOM)) === "HTTP 403", "origine etrangere refusee (403)");
ok((await rejectedWith(ORIGIN, "court")) === "HTTP 400", "identifiant de room invalide refuse (400)");

// 2. deux clients
const A = await client("aaaaaaaaaaaaaaaa", "Alice");
const B = await client("bbbbbbbbbbbbbbbb", "Bob");
await sleep(300);
ok(A.last && A.last.peers.length === 2, "les deux clients se voient (peers=2)");

A.send({ t: "note", col: "fantomes", text: "Les deploys du vendredi", author: true });
await sleep(300);
ok(B.last.notes.length === 1 && B.last.notes[0].text === "Les deploys du vendredi", "la note d'Alice arrive chez Bob en direct");
ok(B.last.notes[0].author === "Alice" && B.last.notes[0].mine === false && A.last.notes[0].mine === true, "auteur affiche et propriete correcte");
ok(!JSON.stringify(B.last).includes("aaaaaaaaaaaaaaaa"), "l'identifiant d'Alice n'est jamais envoye a Bob");

const id = A.last.notes[0].id;
B.send({ t: "del", id });
await sleep(200);
ok(A.last.notes.length === 1, "Bob ne peut pas supprimer la note d'Alice");

B.send({ t: "vote", id });
await sleep(200);
ok(A.last.notes[0].votes === 1 && A.last.notes[0].voted === false && B.last.notes[0].voted === true, "vote de Bob compte, voted personnalise");

// limite de 3 votes
for (const t of ["n2", "n3", "n4"]) A.send({ t: "note", col: "toiles", text: t });
await sleep(300);
const ids = B.last.notes.filter((n) => n.text !== "Les deploys du vendredi").map((n) => n.id);
for (const i of ids) B.send({ t: "vote", id: i });
await sleep(300);
ok(B.last.notes.filter((n) => n.voted).length === 3, "limite de 3 votes appliquee cote serveur");

// 3. minuteur
B.send({ t: "timer", op: "start" });
await sleep(200);
ok(A.last.timer.running === true && A.last.timer.endsAt > Date.now(), "minuteur demarre pour tout le monde");
B.send({ t: "timer", op: "pause" });
await sleep(200);
ok(A.last.timer.running === false && A.last.timer.remaining > 0 && A.last.timer.remaining <= 300000, "pause conserve le temps restant");
A.send({ t: "timer", op: "reset", minutes: 10 });
await sleep(200);
ok(B.last.timer.remaining === 600000, "remise a zero a 10 min");

// 4. actions
A.send({ t: "act", text: "Documenter le rollback", owner: "Alice" });
await sleep(200);
const aid = B.last.actions[0].id;
B.send({ t: "actDone", id: aid, done: true });
await sleep(200);
ok(A.last.actions[0].done === true, "action cochee par un autre participant");

// 5. entrees invalides
A.send({ t: "note", col: "inconnue", text: "x" });
A.send({ t: "note", col: "potions", text: "   " });
A.send({ t: "note", col: "potions", text: "a".repeat(5000) });
await sleep(300);
ok(A.last.notes.length === 4, "colonne inconnue, texte vide et message trop gros ignores");

// 6. persistance: Bob se reconnecte et retrouve l'etat
B.ws.close();
await sleep(300);
const B2 = await client("bbbbbbbbbbbbbbbb", "Bob");
await sleep(300);
ok(B2.last.notes.length === 4 && B2.last.notes.filter((n) => n.voted).length === 3, "etat et votes retrouves apres reconnexion");

// 7. ping/pong
B2.ws.send("ping");
await sleep(200);
ok(B2.pong === true, "ping recoit pong");

A.ws.close(); B2.ws.close();

// 8. en-tetes de securite sur la page
const r = await fetch(`http://${BASE}/`);
const csp = r.headers.get("content-security-policy") || "";
ok(csp.includes("default-src 'none'") && r.headers.get("x-frame-options") === "DENY" && r.headers.get("referrer-policy") === "no-referrer", "en-tetes de securite presents sur /");
const f = await fetch(`http://${BASE}/fonts/pirata-one-latin-400-normal.woff2`);
ok(f.status === 200, "police auto-hebergee servie");

console.log(failed ? `\n${failed} echec(s)` : "\ntout est ok");
process.exit(failed ? 1 : 0);
