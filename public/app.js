(function () {
  "use strict";

  var MAX_VOTES = 3;
  var ROOM_RE = /^[A-Za-z0-9_-]{22,64}$/;
  var COLS = [
    { id: "citrouilles", name: "Citrouilles", sub: "Ce qui a bien marché", ph: "Ce qui nous a fait plaisir ce sprint" },
    { id: "fantomes", name: "Fantômes", sub: "Ce qui nous hante", ph: "Le problème qui revient sans cesse" },
    { id: "toiles", name: "Toiles d'araignée", sub: "Ce qui nous bloque", ph: "Ce qui nous ralentit ou nous coince" },
    { id: "potions", name: "Potions magiques", sub: "Idées à tester", ph: "Une idée ou une expérience à tenter" },
    { id: "bonbons", name: "Bonbons ou sort", sub: "Remerciements", ph: "Un merci pour quelqu'un" }
  ];

  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } }
  };
  function randomId(bytes) {
    var a = new Uint8Array(bytes);
    crypto.getRandomValues(a);
    var s = "";
    for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function tiltFor(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
    return ((h % 25) - 12) / 10 + "deg";
  }
  function plural(n, one, many) { return n + " " + (n > 1 ? many : one); }

  $("eyebrow").textContent = "Rétrospective d'équipe - " +
    new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  var room = location.hash.slice(1);
  if (!ROOM_RE.test(room)) {
    $("landing").hidden = false;
    $("create").addEventListener("click", function () {
      location.hash = randomId(16);
      location.reload();
    });
    return;
  }
  window.addEventListener("hashchange", function () { location.reload(); });
  $("app").hidden = false;

  /* ---------- identite locale (jamais envoyee sauf le nom choisi) ---------- */
  var cid = store.get("retro.cid");
  if (!cid) { cid = randomId(16); store.set("retro.cid", cid); }
  var myName = store.get("retro.name");
  var showName = store.get("retro.showName") === "1";

  var state = null, ws = null, connected = false, retry = 0, offset = 0, byVotes = false, pingTimer = null;
  var DK = "retro.drafts." + room;
  var drafts = [];
  try { drafts = JSON.parse(store.get(DK) || "[]"); } catch (e) { drafts = []; }
  if (!Array.isArray(drafts)) drafts = [];
  function saveDrafts() { store.set(DK, JSON.stringify(drafts)); }

  var statusEl = $("status");
  function say(msg, tone) { statusEl.textContent = msg || ""; statusEl.dataset.tone = tone || ""; }

  /* ---------- connexion ---------- */
  function send(obj) {
    if (!ws || ws.readyState !== 1) { say("Tu n'es pas connecté, réessaie dans un instant.", "warn"); return false; }
    ws.send(JSON.stringify(obj));
    return true;
  }
  function hello() { send({ t: "hello", cid: cid, name: myName || "", showName: showName }); }

  function connect() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(proto + "//" + location.host + "/ws?room=" + encodeURIComponent(room));
    ws.onopen = function () {
      retry = 0; connected = true; say("");
      hello();
      clearInterval(pingTimer);
      pingTimer = setInterval(function () { if (ws.readyState === 1) ws.send("ping"); }, 25000);
      renderAll();
    };
    ws.onmessage = function (e) {
      if (e.data === "pong") return;
      var m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m && m.t === "state") {
        state = m;
        offset = m.now - Date.now();
        renderAll();
      }
    };
    ws.onclose = function () {
      connected = false;
      clearInterval(pingTimer);
      renderAll();
      say("Connexion perdue, reconnexion en cours...", "warn");
      var wait = Math.min(10000, 500 * Math.pow(2, retry)) + Math.random() * 300;
      retry += 1;
      setTimeout(connect, wait);
    };
    ws.onerror = function () { /* onclose gere la reprise */ };
  }

  /* ---------- colonnes ---------- */
  var board = $("board");
  var els = {};
  COLS.forEach(function (c) {
    var col = el("section", "col");
    col.style.setProperty("--col", "var(--col-" + c.id + ")");
    col.setAttribute("aria-labelledby", "h-" + c.id);

    var head = el("div", "col-head");
    var title = el("div", "col-title");
    var h2 = el("h2", null, c.name); h2.id = "h-" + c.id;
    var count = el("span", "count", "0");
    title.append(h2, count);
    head.append(title, el("p", "col-sub", c.sub));

    var list = el("div", "notes");

    var priv = el("div", "priv");
    var ph = el("div", "priv-head");
    ph.append(el("h3", null, "Ma crypte privée"));
    var pubCol = el("button", "mini solid", "Tout publier"); pubCol.type = "button";
    ph.append(pubCol);
    var ta = document.createElement("textarea");
    ta.id = "ta-" + c.id; ta.maxLength = 280; ta.rows = 2;
    ta.placeholder = c.ph + " (Entrée pour enregistrer)";
    ta.setAttribute("aria-label", "Nouveau post-it privé dans " + c.name);
    var dl = el("div", "notes");
    priv.append(ph, el("p", "priv-sub", "Visible par toi seul, gardé dans ton navigateur."), ta, dl);

    col.append(head, list, priv);
    board.append(col);
    els[c.id] = { count: count, list: list, ta: ta, dl: dl, pubCol: pubCol };

    ta.addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter" || ev.shiftKey) return;
      ev.preventDefault();
      var text = ta.value.trim();
      if (!text) return;
      drafts.push({ id: randomId(9), col: c.id, text: text, ts: Date.now() });
      saveDrafts();
      ta.value = "";
      renderDrafts();
    });
    pubCol.addEventListener("click", function () {
      publish(drafts.filter(function (d) { return d.col === c.id; }));
    });
  });

  function publish(list) {
    if (!connected || !list.length) return;
    list.forEach(function (d) {
      if (send({ t: "note", col: d.col, text: d.text, author: showName })) {
        drafts = drafts.filter(function (x) { return x.id !== d.id; });
      }
    });
    saveDrafts();
    renderDrafts();
  }

  /* ---------- rendu ---------- */
  function renderNotes() {
    var notes = state ? state.notes : [];
    var used = notes.filter(function (n) { return n.voted; }).length;
    var left = Math.max(0, MAX_VOTES - used);
    $("votes-left").textContent = String(left);
    $("votes-label").textContent = left > 1 ? "votes restants" : "vote restant";

    COLS.forEach(function (c) {
      var items = notes.filter(function (n) { return n.col === c.id; });
      if (byVotes) items.sort(function (a, b) { return (b.votes - a.votes) || (a.ts - b.ts); });
      els[c.id].count.textContent = String(items.length);
      var nodes = items.map(function (n) {
        var card = el("article", "note");
        card.style.setProperty("--tilt", tiltFor(n.id));
        card.append(el("p", null, n.text));
        if (n.author) card.append(el("span", "by", "- " + n.author));
        var foot = el("div", "note-foot");
        var vb = el("button", "vote");
        vb.type = "button";
        vb.setAttribute("aria-pressed", String(n.voted));
        vb.append(el("span", null, n.voted ? "Voté" : "Voter"), el("span", "n", String(n.votes)));
        vb.disabled = !connected || (!n.voted && left === 0);
        if (!n.voted && left === 0) vb.title = "Tu as utilisé tes 3 votes";
        vb.addEventListener("click", function () { send({ t: "vote", id: n.id }); });
        foot.append(vb);
        if (n.mine) {
          var del = el("button", "del", "Supprimer"); del.type = "button"; del.disabled = !connected;
          del.addEventListener("click", function () { send({ t: "del", id: n.id }); });
          foot.append(del);
        }
        card.append(foot);
        return card;
      });
      if (!nodes.length) nodes.push(el("p", "empty", "Rien de publié pour l'instant."));
      els[c.id].list.replaceChildren.apply(els[c.id].list, nodes);
    });
  }

  function renderDrafts() {
    $("pub-all").textContent = drafts.length ? "Tout publier (" + drafts.length + ")" : "Tout publier";
    $("pub-all").disabled = !connected || !drafts.length;
    COLS.forEach(function (c) {
      var mine = drafts.filter(function (d) { return d.col === c.id; });
      var nodes = mine.map(function (d) {
        var box = el("div", "draft");
        box.append(el("p", null, d.text));
        var foot = el("div", "draft-foot");
        var pb = el("button", "mini", "Publier"); pb.type = "button"; pb.disabled = !connected;
        pb.addEventListener("click", function () { publish([d]); });
        var rm = el("button", "link", "Supprimer"); rm.type = "button";
        rm.addEventListener("click", function () {
          drafts = drafts.filter(function (x) { return x.id !== d.id; });
          saveDrafts(); renderDrafts();
        });
        foot.append(pb, rm);
        box.append(foot);
        return box;
      });
      els[c.id].dl.replaceChildren.apply(els[c.id].dl, nodes);
      els[c.id].pubCol.hidden = !mine.length;
      els[c.id].pubCol.disabled = !connected;
    });
  }

  var actsEl = $("acts");
  function renderActions() {
    var list = state ? state.actions : [];
    var rows = list.map(function (a) {
      var row = el("div", "act");
      row.dataset.done = a.done ? "1" : "";
      var cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = !!a.done; cb.disabled = !connected;
      cb.setAttribute("aria-label", "Action terminée");
      cb.addEventListener("change", function () { send({ t: "actDone", id: a.id, done: cb.checked }); });
      row.append(cb, el("span", "txt", a.text), el("span", "owner", a.owner || "Sans responsable"));
      var del = el("button", "link", "Supprimer"); del.type = "button"; del.disabled = !connected;
      del.addEventListener("click", function () { send({ t: "actDel", id: a.id }); });
      row.append(del);
      return row;
    });
    if (!rows.length) rows.push(el("p", "empty", "Aucune action pour l'instant. Ajoute celles que l'équipe décide pendant la discussion."));
    actsEl.replaceChildren.apply(actsEl, rows);
    $("act-add").disabled = !connected;
    $("act-text").disabled = !connected;
    $("act-owner").disabled = !connected;
  }

  $("act-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var text = $("act-text").value.trim();
    if (!text) return;
    if (send({ t: "act", text: text, owner: $("act-owner").value.trim() })) {
      $("act-text").value = ""; $("act-owner").value = "";
    }
  });

  /* ---------- reinitialisation (confirmation en deux clics) ---------- */
  var resetBtn = $("reset"), resetTimer = null;
  function disarmReset() {
    clearTimeout(resetTimer);
    resetBtn.dataset.armed = "";
    resetBtn.textContent = "Réinitialiser";
  }
  resetBtn.addEventListener("click", function () {
    if (resetBtn.dataset.armed !== "1") {
      resetBtn.dataset.armed = "1";
      resetBtn.textContent = "Confirmer: tout effacer";
      say("Cela efface tous les post-its, votes et actions pour toute l'équipe. Clique encore pour confirmer.", "warn");
      resetTimer = setTimeout(function () { disarmReset(); say(""); }, 6000);
      return;
    }
    disarmReset();
    if (send({ t: "reset" })) say("Board réinitialisé pour toute l'équipe.");
  });

  function renderPeers() {
    var peers = state ? state.peers : [];
    var box = $("peers");
    if (!peers.length) { box.hidden = true; return; }
    box.hidden = false;
    $("peers-sum").textContent = plural(peers.length, "connecté", "connectés");
    var items = peers.map(function (n) { return el("li", null, n || "Anonyme"); });
    $("peers-list").replaceChildren.apply($("peers-list"), items);
  }

  /* ---------- minuteur ---------- */
  var clockEl = $("clock");
  function timerView() {
    var t = state ? state.timer : { running: false, endsAt: 0, remaining: 300000 };
    var ms = t.running ? Math.max(0, t.endsAt - (Date.now() + offset)) : t.remaining;
    return { t: t, ms: ms };
  }
  function fmt(ms) {
    var s = Math.ceil(ms / 1000), m = Math.floor(s / 60);
    return m + ":" + String(s % 60).padStart(2, "0");
  }
  function paintClock() {
    var v = timerView();
    clockEl.textContent = fmt(v.ms);
    clockEl.dataset.low = (v.t.running && v.ms <= 30000) ? "1" : "";
  }
  function renderTimer() {
    var v = timerView();
    $("t-toggle").textContent = v.t.running ? "Pause" : "Démarrer";
    $("t-toggle").disabled = !connected;
    $("t-reset").disabled = !connected;
    $("t-len").disabled = !connected;
    paintClock();
  }
  $("t-toggle").addEventListener("click", function () {
    send({ t: "timer", op: timerView().t.running ? "pause" : "start" });
  });
  $("t-reset").addEventListener("click", function () {
    send({ t: "timer", op: "reset", minutes: Number($("t-len").value) });
  });
  $("t-len").addEventListener("change", function () {
    send({ t: "timer", op: "reset", minutes: Number($("t-len").value) });
  });
  setInterval(paintClock, 250);

  /* ---------- barre d'outils ---------- */
  $("sort").addEventListener("click", function () {
    byVotes = !byVotes;
    $("sort").setAttribute("aria-pressed", String(byVotes));
    renderNotes();
  });
  $("pub-all").addEventListener("click", function () { publish(drafts.slice()); });

  $("copy").addEventListener("click", function () {
    var url = location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () { say("Lien copié. Partage-le seulement avec ton équipe."); },
        function () { say("Copie manuelle: " + url); }
      );
    } else {
      say("Copie manuelle: " + url);
    }
  });

  function buildExport() {
    var notes = state ? state.notes : [];
    var actions = state ? state.actions : [];
    var out = ["# Retro Halloween - " + new Date().toLocaleDateString("fr-FR"), ""];
    COLS.forEach(function (c) {
      out.push("## " + c.name + " (" + c.sub + ")", "");
      var items = notes.filter(function (n) { return n.col === c.id; })
        .sort(function (a, b) { return (b.votes - a.votes) || (a.ts - b.ts); });
      if (!items.length) out.push("_Aucun post-it._");
      items.forEach(function (n) {
        out.push("- " + String(n.text).replace(/\s*\n\s*/g, " ") + (n.votes ? " (" + plural(n.votes, "vote", "votes") + ")" : ""));
      });
      out.push("");
    });
    out.push("## Actions", "");
    if (!actions.length) out.push("_Aucune action._");
    actions.forEach(function (a) {
      out.push("- [" + (a.done ? "x" : " ") + "] " + a.text + (a.owner ? " (" + a.owner + ")" : ""));
    });
    return out.join("\n") + "\n";
  }
  $("export").addEventListener("click", function () {
    var blob = new Blob([buildExport()], { type: "text/markdown;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "retro-halloween-" + new Date().toISOString().slice(0, 10) + ".md";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  /* ---------- nom ---------- */
  var dlg = $("who");
  function askName() {
    $("who-name").value = myName || "";
    $("who-show").checked = showName;
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    $("who-name").focus();
  }
  $("who-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    myName = $("who-name").value.trim().slice(0, 24);
    showName = $("who-show").checked;
    store.set("retro.name", myName);
    store.set("retro.showName", showName ? "1" : "0");
    if (typeof dlg.close === "function") dlg.close(); else dlg.removeAttribute("open");
    if (connected) hello();
  });
  $("rename").addEventListener("click", askName);

  function renderAll() {
    renderNotes(); renderDrafts(); renderActions(); renderPeers(); renderTimer();
    $("reset").disabled = !connected;
  }

  renderAll();
  if (store.get("retro.name") === null) askName();
  connect();
})();
