(() => {
  const tg = window.Telegram ? window.Telegram.WebApp : null;
  if (tg) {
    tg.ready();
    tg.expand();
  }

  // Clean SVG chess pieces inspired by classic vector tournament sets
  function pieceSvg(code) {
    const isWhite = code === code.toUpperCase();
    const fill = isWhite ? "#ffffff" : "#18181b";
    const stroke = isWhite ? "#1e293b" : "#e2e8f0";
    const t = code.toLowerCase();
    const shapes = {
      p: `<circle cx="22.5" cy="14" r="5.5"/><path d="M16 32c0-5 3-9 6.5-9s6.5 4 6.5 9H16z"/><rect x="13" y="33" width="19" height="4" rx="2"/>`,
      r: `<path d="M13 10h4v4h3.5v-4h4v4H28v-4h4v8l-3 3v11H16V21l-3-3v-8z"/><rect x="12" y="33" width="21" height="4" rx="2"/>`,
      n: `<path d="M14 33l2-11-3-3 6-8 4-2 2 3c4 1 7 5 7 10v11H14z"/><circle cx="20" cy="15" r="1.4" fill="${stroke}"/>`,
      b: `<ellipse cx="22.5" cy="17" rx="6" ry="9"/><circle cx="22.5" cy="7" r="2.2"/><path d="M14 33l3-7h11l3 7H14z"/>`,
      q: `<path d="M10 15l5 13h15l5-13-7 6-5.5-9-5.5 9-7-6z"/><circle cx="10" cy="13" r="2"/><circle cx="22.5" cy="10" r="2.2"/><circle cx="35" cy="13" r="2"/><rect x="13" y="31" width="19" height="5" rx="2"/>`,
      k: `<path d="M21 6h3v5h5v3h-5v4h-3v-4h-5v-3h5V6z"/><path d="M13 21c0-4 4-7 9.5-7s9.5 3 9.5 7l-3 10H16l-3-10z"/><rect x="13" y="32" width="19" height="5" rx="2"/>`,
    };
    return `<svg viewBox="0 0 45 45" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round">${shapes[t] || ""}</svg>`;
  }

  let state = {
    userId: "",
    userName: "Player",
    profile: null,
    botUsername: "",
    selectedGame: "chess",
    lbGame: "overall",
    room: null,
    ws: null,
    selectedSquare: null,
    clockTimer: null,
    prevView: "home",
    isAdmin: false,
    currentGameUrl: "",
  };

  const profilePill = document.getElementById("profilePill");
  const navItems = document.querySelectorAll(".nav-item");
  const views = {
    home: document.getElementById("view-home"),
    battle: document.getElementById("view-battle"),
    match: document.getElementById("view-match"),
    ranks: document.getElementById("view-ranks"),
    profile: document.getElementById("view-profile"),
    community: document.getElementById("view-community"),
    player: document.getElementById("view-player"),
    addGame: document.getElementById("view-add-game"),
  };

  // --- DAY / NIGHT THEME SWITCH (SCREENSHOT 1) ---
  const themeToggleBtn = document.getElementById("themeToggleBtn");
  function applyTheme(theme) {
    const isLight = (theme === "light");
    document.body.classList.toggle("theme-light", isLight);
    document.documentElement.classList.toggle("theme-light", isLight);
    document.documentElement.setAttribute("data-theme", isLight ? "light" : "dark");
    try { localStorage.setItem("app_theme", isLight ? "light" : "dark"); } catch (_) {}
  }

  // Initial apply
  applyTheme(localStorage.getItem("app_theme") || "dark");

  function triggerThemeBubbleTransition(x, y, newTheme) {
    const bubble = document.createElement("div");
    bubble.className = "theme-bubble-wave";
    bubble.style.left = `${x}px`;
    bubble.style.top = `${y}px`;
    if (newTheme === "light") {
      bubble.style.background = "radial-gradient(circle, #ffffff 0%, #e2e8f0 100%)";
    } else {
      bubble.style.background = "radial-gradient(circle, #0b1120 0%, #060911 100%)";
    }
    document.body.appendChild(bubble);

    // Force reflow
    void bubble.offsetWidth;
    bubble.classList.add("active");

    setTimeout(() => {
      applyTheme(newTheme);
    }, 180);

    setTimeout(() => {
      bubble.classList.add("fade-out");
      setTimeout(() => bubble.remove(), 400);
    }, 450);
  }

  themeToggleBtn?.addEventListener("click", (e) => {
    const rect = themeToggleBtn.getBoundingClientRect();
    const x = e.clientX || (rect.left + rect.width / 2);
    const y = e.clientY || (rect.top + rect.height / 2);
    const isCurrentlyLight = document.body.classList.contains("theme-light");
    const newTheme = isCurrentlyLight ? "dark" : "light";
    triggerThemeBubbleTransition(x, y, newTheme);
    try {
      if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred("light");
      }
    } catch (_) {}
  });

  function teardownArenaIframe() {
    const iframe = document.getElementById("arenaGameIframe");
    if (iframe) {
      try {
        iframe.contentWindow?.postMessage({ action: "destroy", type: "close", cmd: "stop" }, "*");
        iframe.src = "about:blank";
        iframe.remove();
      } catch (_) {}
    }
    const container = document.getElementById("boardContainer");
    if (container) {
      container.innerHTML = "";
    }
  }

  window.addEventListener("pagehide", teardownArenaIframe);
  window.addEventListener("beforeunload", teardownArenaIframe);

  function showView(name) {
    if (name !== "match") {
      teardownArenaIframe();
    }
    if (name !== "addGame" && name !== "player" && name !== "match") {
      state.prevView = name;
    }
    Object.entries(views).forEach(([k, el]) => {
      if (el) el.classList.toggle("active", k === name);
    });
    navItems.forEach((n) => n.classList.toggle("active", n.dataset.view === name));
    
    const isFullscreen = name === "match" || name === "player" || name === "addGame";
    document.getElementById("bottomNav")?.classList.toggle("hidden", isFullscreen);
    document.querySelector(".topbar")?.classList.toggle("hidden", isFullscreen);

    // Expand view to comfortable full viewport with safe headroom (no aggressive requestFullscreen to prevent overlapping top controls)
    try { tg?.expand(); } catch (_) {}

    if (window.lucide) {
      setTimeout(() => { window.lucide.createIcons(); }, 10);
    }
  }

  function haptic(type = "light") {
    try { tg?.HapticFeedback?.impactOccurred(type); } catch (_) {}
  }

  function formatClock(sec) {
    const s = Math.max(0, Math.ceil(sec));
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toString().padStart(2, "0")}`;
  }

  function renderProfileSummary(profile) {
    if (!profile) return;
    state.profile = profile;
    const elo = Math.round(profile.elo);
    const total = (profile.wins || 0) + (profile.losses || 0) + (profile.draws || 0);
    const wr = total ? Math.round((profile.wins / total) * 100) : 0;

    const hpName = document.getElementById("homePlayerName");
    if (hpName) hpName.textContent = profile.display_name || "Player";
    const hpUser = document.getElementById("homeUsername");
    if (hpUser) hpUser.textContent = profile.username ? `@${profile.username}` : `@user${profile.user_id}`;

    // Read stored coins or initialize
    const storedCoins = localStorage.getItem("flipster_coins") || "1250";
    const coinValEl = document.getElementById("coinVal");
    if (coinValEl) coinValEl.textContent = Number(storedCoins).toLocaleString();
    const energyValEl = document.getElementById("energyVal");
    if (energyValEl) energyValEl.textContent = "25";

    const pct = Math.min(100, Math.round(((profile.xp_progress || 0) / (profile.xp_next || 100)) * 100));

    // Profile View Elements
    const pName = document.getElementById("profPlayerName");
    if (pName) pName.textContent = profile.display_name || "Player";
    const pTier = document.getElementById("profTierBadge");
    if (pTier) pTier.textContent = `${profile.tier?.icon || "🥉"} ${profile.tier?.name || "Bronze"}`;
    const pElo = document.getElementById("profGlobalElo");
    if (pElo) pElo.textContent = `${Math.round(profile.elo || 1200)} ELO`;
    const pLvl = document.getElementById("profLevelBadge");
    if (pLvl) pLvl.textContent = `LEVEL ${profile.level || 1}`;
    const pXpTxt = document.getElementById("profXpText");
    if (pXpTxt) pXpTxt.textContent = `${profile.xp_progress || 0} / ${profile.xp_next || 100} XP`;
    const pXpFill = document.getElementById("profXpFill");
    if (pXpFill) pXpFill.style.width = `${pct}%`;

    const sMatches = document.getElementById("profStatTotal");
    if (sMatches) sMatches.textContent = total;
    const sWins = document.getElementById("profStatWins");
    if (sWins) sWins.textContent = profile.wins || 0;
    const sWr = document.getElementById("profStatWinRate");
    if (sWr) sWr.textContent = `${wr}%`;
    const sStreak = document.getElementById("profStatStreak");
    if (sStreak) sStreak.textContent = profile.wins > 0 ? `${profile.wins}` : "0";

    const gr = profile.game_ratings || {};
    ["chess", "othello", "connect4", "tictactoe"].forEach((g) => {
      const span = document.querySelector(`[data-elo="${g}"]`);
      if (span) {
        const gElo = gr[g] ? Math.round(gr[g].elo) : 1200;
        span.textContent = `${gElo} ELO`;
      }
    });
  }

  async function refreshProfileAndHistory() {
    if (!state.userId) return;
    const res = await fetch(`/api/profile/${encodeURIComponent(state.userId)}`);
    if (!res.ok) return;
    const data = await res.json();
    renderProfileSummary(data.profile);

    const ratingsEl = document.getElementById("profileRatingsGrid");
    const games = ["chess", "othello", "connect4", "tictactoe", "dots_and_boxes", "rps"];
    const gameIcons = {
      chess: "♟️",
      othello: "⚫",
      connect4: "🔴",
      tictactoe: "❌",
      dots_and_boxes: "📦",
      rps: "✂️"
    };
    const gr = data.profile.game_ratings || {};
    ratingsEl.innerHTML = games
      .map((g) => {
        const item = gr[g] || { elo: 1200, wins: 0, losses: 0, draws: 0, tier: { icon: "🥉", name: "Bronze" } };
        const icon = gameIcons[g] || "🎮";
        const gName = g.replaceAll("_", " ").toUpperCase();
        return `
          <div class="rating-box">
            <div class="rb-icon">${icon}</div>
            <div class="rb-title">${gName}</div>
            <div class="rb-elo">${item.tier?.icon || "🥉"} ${Math.round(item.elo)}</div>
            <div class="rb-record">${item.wins}W • ${item.losses}L • ${item.draws}D</div>
          </div>`;
      })
      .join("");

    const histEl = document.getElementById("matchHistoryList");
    const ranksHistEl = document.getElementById("ranksHistoryList");
    if (!data.history.length) {
      const emptyMsg = `<div style="text-align:center;color:var(--muted);padding:14px;font-size:0.85rem;">No ranked PvP matches played yet.<br>Jump into the <strong>Battle</strong> tab to play!</div>`;
      if (histEl) histEl.innerHTML = emptyMsg;
      if (ranksHistEl) ranksHistEl.innerHTML = emptyMsg;
      return;
    }
    const historyHtml = data.history
      .map((m) => {
        const isP1 = m.player1_id === state.userId;
        const opp = isP1 ? m.player2_name : m.player1_name;
        const delta = isP1 ? m.p1_elo_delta : m.p2_elo_delta;
        const isWin = m.winner_id === state.userId;
        const isDraw = !m.winner_id;
        const resTag = isDraw ? "DRAW" : isWin ? "WIN" : "LOSS";
        const resClass = isDraw ? "draw" : isWin ? "win" : "loss";
        const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;
        return `
          <div class="history-item ${resClass}">
            <div class="hi-left">
              <span class="hi-badge ${resClass}">${resTag}</span>
              <div class="hi-info">
                <div class="hi-opp">vs ${escapeHtml(opp)}</div>
                <div class="hi-game">${(m.game_type || "pvp").toUpperCase()}</div>
              </div>
            </div>
            <div class="hi-delta ${delta >= 0 ? 'pos' : 'neg'}">${deltaStr} ELO</div>
          </div>`;
      })
      .join("");
    if (histEl) histEl.innerHTML = historyHtml;
    if (ranksHistEl) ranksHistEl.innerHTML = historyHtml;
  }

  async function refreshLiveRooms() {
    const el = document.getElementById("liveRoomsList");
    const res = await fetch("/api/rooms");
    if (!res.ok) return;
    const data = await res.json();
    if (!data.rooms.length) {
      el.textContent = "No active PvP matches right now. Start one in Battle!";
      return;
    }
    el.innerHTML = data.rooms
      .map(
        (r) => `
      <div class="live-row">
        <span><strong>${r.game_type}</strong>: ${r.players.join(" vs ")} (👁️ ${r.spectators})</span>
        <button class="btn small primary" data-watch="${r.room_id}">Watch</button>
      </div>`
      )
      .join("");
    el.querySelectorAll("[data-watch]").forEach((btn) => {
      btn.addEventListener("click", () => connectRoom(btn.dataset.watch));
    });
  }

  async function initAuth() {
    let guestId = localStorage.getItem("arena_guest_id");
    if (!guestId) {
      guestId = "g_" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem("arena_guest_id", guestId);
    }
    const guestName = localStorage.getItem("arena_guest_name") || "Challenger";

    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        init_data: tg?.initData || "",
        guest_id: guestId,
        guest_name: guestName,
      }),
    });
    const data = await res.json();
    state.userId = data.profile.user_id;
    state.userName = data.profile.display_name;
    state.botUsername = data.bot_username || "";
    state.isAdmin = Boolean(data.is_admin);

    const adminGameButtons = [
      document.getElementById("btnOpenAddGameModal"),
      document.getElementById("btnNavAddGame"),
      document.getElementById("btnShortcutAddGame"),
    ];
    adminGameButtons.forEach((btn) => {
      if (!btn) return;
      if (state.isAdmin) {
        btn.classList.remove("hidden");
      } else {
        btn.classList.add("hidden");
      }
    });

    renderProfileSummary(data.profile);
    refreshLiveRooms();
    loadCustomGames();

    const urlParams = new URLSearchParams(window.location.search);
    const startParam = tg?.initDataUnsafe?.start_param || urlParams.get("tgWebAppStartParam") || urlParams.get("startapp") || "";
    const urlRoom = urlParams.get("room") || "";
    if (startParam.startsWith("room_")) {
      setTimeout(() => joinRoom(startParam.replace("room_", "")), 200);
    } else if (urlRoom) {
      setTimeout(() => joinRoom(urlRoom), 200);
    }
  }

  async function startRoomRequest(opts) {
    haptic("medium");
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        game_type: state.selectedGame,
        user_id: state.userId,
        name: state.userName,
        ...opts,
      }),
    });
    const data = await res.json();
    connectRoom(data.room.room_id);
  }

  async function joinRoom(code) {
    const clean = (code || "").trim().toUpperCase();
    if (!clean) return;
    const check = await fetch(`/api/rooms/${clean}`);
    let gameType = state.selectedGame;
    if (check.ok) {
      const existing = await check.json();
      gameType = existing.room.game_type;
    }
    await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        game_type: gameType,
        user_id: state.userId,
        name: state.userName,
        room_id: clean,
      }),
    });
    connectRoom(clean);
  }

  function connectRoom(roomId) {
    if (state.ws) {
      state.ws.close();
      state.ws = null;
    }
    state.selectedSquare = null;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${window.location.host}/ws/${roomId}?user_id=${encodeURIComponent(
      state.userId
    )}&name=${encodeURIComponent(state.userName)}`;
    const ws = new WebSocket(wsUrl);
    state.ws = ws;

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "state") {
        state.room = msg.room;
        renderMatch();
        if (msg.room.status === "finished") refreshProfileAndHistory();
      } else if (msg.type === "chat") {
        appendMatchChatMessage(msg);
      } else if (msg.type === "error") {
        alert(msg.message);
        showView("battle");
      }
    };

    showView("match");
    startLocalClockTicker();
  }

  function startLocalClockTicker() {
    if (state.clockTimer) clearInterval(state.clockTimer);
    state.clockTimer = setInterval(() => {
      if (!state.room || state.room.status !== "active") return;
      const active = state.room.players.find((p) => p.role === state.room.turn_role);
      if (active && !active.is_ai && active.clock > 0) {
        active.clock = Math.max(0, active.clock - 1);
        updatePlayerCards();
      }
    }, 1000);
  }

  function sendWs(payload) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(payload));
    }
  }

  function playMatchResultAudio(type) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const actx = new AudioCtx();
      const now = actx.currentTime;

      if (type === "win") {
        // Celebratory major ascending fanfare: C5, E5, G5, C6
        const freqs = [523.25, 659.25, 783.99, 1046.50];
        freqs.forEach((f, i) => {
          const osc = actx.createOscillator();
          const gain = actx.createGain();
          osc.type = "triangle";
          osc.frequency.setValueAtTime(f, now + i * 0.12);
          gain.gain.setValueAtTime(0.22, now + i * 0.12);
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.35);
          osc.connect(gain);
          gain.connect(actx.destination);
          osc.start(now + i * 0.12);
          osc.stop(now + i * 0.12 + 0.36);
        });
      } else if (type === "loss") {
        // Minor descending tone: G3, Eb3, C3
        const freqs = [196.0, 155.56, 130.81];
        freqs.forEach((f, i) => {
          const osc = actx.createOscillator();
          const gain = actx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(f, now + i * 0.18);
          gain.gain.setValueAtTime(0.2, now + i * 0.18);
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.4);
          osc.connect(gain);
          gain.connect(actx.destination);
          osc.start(now + i * 0.18);
          osc.stop(now + i * 0.18 + 0.42);
        });
      } else {
        // Harmonic draw chime: E4, G4
        [329.63, 392.0].forEach((f, i) => {
          const osc = actx.createOscillator();
          const gain = actx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(f, now + i * 0.14);
          gain.gain.setValueAtTime(0.18, now + i * 0.14);
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.14 + 0.35);
          osc.connect(gain);
          gain.connect(actx.destination);
          osc.start(now + i * 0.14);
          osc.stop(now + i * 0.14 + 0.36);
        });
      }
    } catch (_) {}
  }

  let unreadChatCount = 0;
  let isChatOpen = false;

  function appendMatchChatMessage(msg) {
    const list = document.getElementById("chatMessagesList");
    if (!list) return;
    const isSelf = msg.sender_id === state.userId;
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${isSelf ? "self" : "opp"}`;
    const name = escapeHtml(msg.sender_name || (isSelf ? "You" : "Opponent"));
    const text = escapeHtml(msg.text || "");
    bubble.innerHTML = `
      <div class="chat-sender-name">${name}</div>
      <div class="chat-text">${text}</div>
    `;
    list.appendChild(bubble);
    list.scrollTop = list.scrollHeight;

    if (!isChatOpen && !isSelf) {
      unreadChatCount++;
      const badge = document.getElementById("chatBadge");
      if (badge) {
        badge.textContent = unreadChatCount > 9 ? "9+" : unreadChatCount;
        badge.classList.remove("hidden");
      }
      try { tg?.HapticFeedback?.notificationOccurred("warning"); } catch (_) {}
    }
  }

  function toggleMatchChat(open) {
    const modal = document.getElementById("matchChatModal");
    if (!modal) return;
    if (open === undefined) open = modal.classList.contains("hidden");
    isChatOpen = open;
    if (open) {
      modal.classList.remove("hidden");
      unreadChatCount = 0;
      const badge = document.getElementById("chatBadge");
      if (badge) badge.classList.add("hidden");
      const inp = document.getElementById("chatInputText");
      if (inp) inp.focus();
    } else {
      modal.classList.add("hidden");
    }
  }

  function sendMatchChat(text) {
    if (!text || !text.trim()) return;
    sendWs({ type: "chat", text: text.trim() });
  }

  function updatePlayerCards() {
    const room = state.room;
    if (!room) return;
    const selfP = room.players.find((p) => p.user_id === state.userId) || room.players[0];
    const oppP = room.players.find((p) => p.user_id !== selfP?.user_id);

    const selfCard = document.getElementById("selfCard");
    const oppCard = document.getElementById("opponentCard");
    const isChess = room.game_type === "chess";

    if (selfP) {
      let extra = "";
      if (room.game_type === "othello" && room.counts) extra = ` • ${room.counts[selfP.role] ?? 0}`;
      const nameEl = document.getElementById("selfName") || selfCard?.querySelector(".p-name");
      const eloEl = document.getElementById("selfElo") || selfCard?.querySelector(".p-elo");
      const clockEl = document.getElementById("selfClock") || selfCard?.querySelector(".p-clock");
      if (nameEl) nameEl.textContent = `${selfP.name}${extra}`;
      if (eloEl) eloEl.textContent = isChess ? `${selfP.elo} ELO` : `🏆 ${selfP.wins || 0} Wins`;
      if (clockEl) clockEl.textContent = formatClock(selfP.clock);
      selfCard?.classList.toggle("active-turn", room.status === "active" && room.turn_role === selfP.role);
    }

    if (oppP) {
      let extra = "";
      if (room.game_type === "othello" && room.counts) extra = ` • ${room.counts[oppP.role] ?? 0}`;
      const nameEl = document.getElementById("oppName") || oppCard?.querySelector(".p-name");
      const eloEl = document.getElementById("oppElo") || oppCard?.querySelector(".p-elo");
      const clockEl = document.getElementById("oppClock") || oppCard?.querySelector(".p-clock");
      const dotEl = document.getElementById("oppStatusDot");
      if (nameEl) nameEl.textContent = `${oppP.name}${extra}`;
      const oppRating = isChess ? (oppP.is_ai ? "AI" : `${oppP.elo} ELO`) : (oppP.is_ai ? "AI Bot" : `🏆 ${oppP.wins || 0} Wins`);
      if (eloEl) eloEl.textContent = oppRating;
      if (clockEl) clockEl.textContent = oppP.is_ai ? "∞" : formatClock(oppP.clock);
      if (dotEl) dotEl.classList.add("active");
      oppCard?.classList.toggle("active-turn", room.status === "active" && room.turn_role === oppP.role);
    } else {
      const nameEl = document.getElementById("oppName") || oppCard?.querySelector(".p-name");
      const eloEl = document.getElementById("oppElo") || oppCard?.querySelector(".p-elo");
      const clockEl = document.getElementById("oppClock") || oppCard?.querySelector(".p-clock");
      const dotEl = document.getElementById("oppStatusDot");
      if (nameEl) nameEl.textContent = "Waiting for opponent...";
      if (eloEl) eloEl.textContent = isChess ? "-- ELO" : "-- Wins";
      if (clockEl) clockEl.textContent = "--:--";
      if (dotEl) dotEl.classList.remove("active");
      oppCard?.classList.remove("active-turn");
    }
  }

  function parseFenBoard(fen) {
    return fen
      .split(" ")[0]
      .split("/")
      .map((row) => {
        const out = [];
        for (const ch of row) {
          if (/[1-8]/.test(ch)) for (let i = 0; i < Number(ch); i++) out.push("");
          else out.push(ch);
        }
        return out;
      });
  }

  function renderMatch() {
    const room = state.room;
    if (!room) return;

    document.getElementById("roomBadge").textContent = `Room: ${room.room_id}`;
    document.getElementById("specPill").textContent = `👁️ ${room.spectators || 0}`;
    updatePlayerCards();

    const selfP = room.players.find((p) => p.user_id === state.userId);
    const oppP = room.players.find((p) => p.user_id !== selfP?.user_id);
    const isSpectator = !selfP;
    const myTurn = !isSpectator && room.status === "active" && selfP.role === room.turn_role;

    const banner = document.getElementById("statusBanner");
    if (room.status === "waiting") {
      banner.textContent = `Share code ${room.room_id} or tap Invite!`;
    } else if (room.status === "finished") {
      if (room.winner_role === "Draw") banner.textContent = `🤝 Draw (${room.reason || "Draw"})`;
      else {
        const winP = room.players.find((p) => p.role === room.winner_role);
        banner.textContent = `🏆 ${winP ? winP.name : room.winner_role} wins! (${room.reason})`;
      }
    } else if (isSpectator) {
      const active = room.players.find((p) => p.role === room.turn_role);
      banner.textContent = `👁️ Spectating • ${active ? active.name : room.turn_role}'s turn`;
    } else {
      const checkNote = room.in_check ? " • ⚠️ CHECK!" : "";
      banner.textContent = (myTurn ? "👉 Your turn!" : "⏳ Opponent's turn...") + checkNote;
    }

    // Match Result Celebration Pop-up
    if (room.status === "active") {
      state.resultModalShown = false;
      document.getElementById("modalMatchResult")?.classList.add("hidden");
    } else if (room.status === "finished") {
      const existingIframe = document.getElementById("arenaGameIframe");
      if (existingIframe) {
        try {
          existingIframe.contentWindow?.postMessage({ action: "destroy", type: "close", cmd: "stop" }, "*");
        } catch (_) {}
      }
      if (!state.resultModalShown) {
        state.resultModalShown = true;
        const modal = document.getElementById("modalMatchResult");
      if (modal) {
        const isDraw = room.winner_role === "Draw";
        const isWin = !isDraw && selfP && room.winner_role === selfP.role;
        const iconEl = document.getElementById("resultModalIcon");
        const titleEl = document.getElementById("resultModalTitle");
        const subEl = document.getElementById("resultModalSubtitle");
        const statsEl = document.getElementById("resultModalStats");

        if (isDraw) {
          if (iconEl) iconEl.textContent = "🤝";
          if (titleEl) {
            titleEl.textContent = "DRAW!";
            titleEl.className = "result-title draw";
          }
          if (subEl) subEl.textContent = room.reason || "The match ended in a draw!";
          playMatchResultAudio("draw");
          try { tg?.HapticFeedback?.notificationOccurred("warning"); } catch (_) {}
        } else if (isWin) {
          if (iconEl) iconEl.textContent = "🏆";
          if (titleEl) {
            titleEl.textContent = "VICTORY!";
            titleEl.className = "result-title win";
          }
          if (subEl) subEl.textContent = `You defeated ${oppP ? oppP.name : "opponent"}! (${room.reason || "Game Won"})`;
          playMatchResultAudio("win");
          try { tg?.HapticFeedback?.notificationOccurred("success"); } catch (_) {}
        } else {
          if (iconEl) iconEl.textContent = "💔";
          if (titleEl) {
            titleEl.textContent = "DEFEAT";
            titleEl.className = "result-title loss";
          }
          if (subEl) subEl.textContent = `${oppP ? oppP.name : "Opponent"} won (${room.reason || "Game Lost"})`;
          playMatchResultAudio("loss");
          try { tg?.HapticFeedback?.notificationOccurred("error"); } catch (_) {}
        }

        if (statsEl) {
          const gameTitle = room.game_type === "chess" ? "Chess" : (room.game_type === "tictactoe" ? "XO Blitz" : room.game_type.toUpperCase());
          statsEl.textContent = `Game: ${gameTitle} • Result: ${room.reason || "Completed"}`;
        }
        modal.classList.remove("hidden");
      }
    }
  }

    document.getElementById("btnResign").classList.toggle("hidden", isSpectator || room.status !== "active");
    document.getElementById("btnRematch").classList.toggle("hidden", isSpectator || room.status !== "finished");

    const ticker = document.getElementById("chessMoveTicker");
    if (ticker) {
      if (room.game_type === "chess") {
        ticker.style.display = "block";
        const lastMove = room.state.last_move || (room.state.history && room.state.history.length ? room.state.history[room.state.history.length - 1] : null);
        if (lastMove) {
          ticker.textContent = typeof lastMove === "string" ? lastMove : `1. ${lastMove}`;
        } else {
          ticker.textContent = "1. Start";
        }
      } else {
        ticker.style.display = "none";
      }
    }
    const modePill = document.getElementById("matchModePill");
    if (modePill) {
      const isRated = room.rated !== false ? "Rated" : "Casual";
      modePill.textContent = `🔥 3+2 • ${isRated}`;
    }

    const isArcade = room.game_type === "knife_hit" || room.game_type === "fruit_slice" || room.game_type === "sheep_fight" || room.game_type === "virus_breaker";
    views.match.classList.toggle("arena-mode-arcade", isArcade);

    const container = document.getElementById("boardContainer");
    if (!isArcade) {
      container.innerHTML = "";
    }

    if (room.game_type === "chess") renderChessBoard(container, room, selfP, myTurn);
    else if (room.game_type === "othello") renderOthelloBoard(container, room, myTurn);
    else if (room.game_type === "connect4") renderConnect4Board(container, room, myTurn);
    else if (isArcade) renderArcadeArenaGame(container, room, selfP);
    else renderTicTacToeBoard(container, room, myTurn);
  }

  function renderArcadeArenaGame(container, room, selfP) {
    const oppP = room.players.find(p => p.user_id !== selfP?.user_id) || { name: "Rival", elo: 1200 };
    const isP1 = selfP?.role === "P1";
    const myScore = isP1 ? (room.state.p1_score || 0) : (room.state.p2_score || 0);
    const oppScore = isP1 ? (room.state.p2_score || 0) : (room.state.p1_score || 0);
    const myLvl = isP1 ? (room.state.p1_level || 1) : (room.state.p2_level || 1);
    const oppLvl = isP1 ? (room.state.p2_level || 1) : (room.state.p1_level || 1);

    const existingIframe = document.getElementById("arenaGameIframe");
    if (existingIframe && existingIframe.dataset.gameType === room.game_type) {
      const myScoreEl = document.getElementById("arenaMyScore");
      const oppScoreEl = document.getElementById("arenaOppScore");
      if (myScoreEl) myScoreEl.textContent = `${myScore} pts (Lvl ${myLvl})`;
      if (oppScoreEl) oppScoreEl.textContent = `${oppScore} pts (Lvl ${oppLvl})`;
      if (existingIframe.contentWindow) {
        existingIframe.contentWindow.postMessage({
          type: "opp_score_update",
          score: oppScore,
          level: oppLvl,
        }, "*");
      }
      return;
    }

    container.innerHTML = "";
    let gamePath = "/static/games/fruit_slice/index.html";
    if (room.game_type === "knife_hit") gamePath = "/static/games/knife_hit/index.html";
    else if (room.game_type === "sheep_fight") gamePath = "/static/games/sheep_fight/index.html";
    else if (room.game_type === "virus_breaker") gamePath = "/static/games/virus_breaker/index.html";

    const iframeSrc = `${gamePath}?mode=arena&opp=${encodeURIComponent(oppP.name || "Rival")}`;

    const wrap = document.createElement("div");
    wrap.className = "arcade-arena-wrapper";
    wrap.innerHTML = `
      <div class="arcade-arena-header">
        <button id="btnLeaveArcadeMatch" class="btn-leave-arcade" title="Leave Match">✕</button>
        <div class="aah-player my-score">
          <span class="aah-label">YOU (${selfP?.name || "Player"})</span>
          <span class="aah-val" id="arenaMyScore">${myScore} pts (Lvl ${myLvl})</span>
        </div>
        <div class="aah-vs">⚡ 1v1 LIVE ⚡</div>
        <div class="aah-player opp-score">
          <span class="aah-label">${oppP.name || "Rival"}</span>
          <span class="aah-val" id="arenaOppScore">${oppScore} pts (Lvl ${oppLvl})</span>
        </div>
      </div>
      <iframe id="arenaGameIframe" src="${iframeSrc}" data-game-type="${room.game_type}" class="arcade-arena-iframe" allow="autoplay; fullscreen; gamepad"></iframe>
    `;

    container.appendChild(wrap);

    document.getElementById("btnLeaveArcadeMatch")?.addEventListener("click", () => {
      haptic("medium");
      if (confirm("Leave this active match and return to Arena?")) {
        sendWs({ type: "resign" });
        teardownArenaIframe();
        state.room = null;
        showView("battle");
      }
    });
  }

  function renderChessBoard(container, room, selfP, myTurn) {
    const grid = parseFenBoard(room.state.fen);
    const boardEl = document.createElement("div");
    boardEl.className = "chess-board";

    const flip = selfP?.role === "b";
    const legalMoves = room.legal_moves || [];
    const lastSquares = new Set(room.state.last_squares || []);
    const legalTargets = new Set(
      legalMoves
        .filter((uci) => state.selectedSquare && uci.startsWith(state.selectedSquare))
        .map((uci) => uci.slice(2, 4))
    );

    for (let vr = 0; vr < 8; vr++) {
      for (let vc = 0; vc < 8; vc++) {
        const r = flip ? 7 - vr : vr;
        const c = flip ? 7 - vc : vc;
        const sq = `${String.fromCharCode(97 + c)}${8 - r}`;
        const piece = grid[r][c];

        const sqEl = document.createElement("div");
        sqEl.className = `chess-sq ${(r + c) % 2 === 0 ? "light" : "dark"}`;
        if (lastSquares.has(sq)) sqEl.classList.add("last-move");
        if (state.selectedSquare === sq) sqEl.classList.add("selected");
        if (legalTargets.has(sq)) sqEl.classList.add(piece ? "capture" : "legal");

        // King In-Check Highlight
        if (room.in_check && piece) {
          const checkKingPiece = room.turn_role === "w" ? "K" : "k";
          if (piece === checkKingPiece) {
            sqEl.classList.add("in-check");
          }
        }

        // Lichess corner coordinate labels
        let coordHtml = "";
        if (vc === 0) {
          coordHtml += `<span class="coord-rank">${8 - r}</span>`;
        }
        if (vr === 7) {
          coordHtml += `<span class="coord-file">${String.fromCharCode(97 + c)}</span>`;
        }

        sqEl.innerHTML = (piece ? pieceSvg(piece) : "") + coordHtml;

        sqEl.addEventListener("click", () => {
          if (!myTurn) return;
          if (state.selectedSquare && legalTargets.has(sq)) {
            haptic("medium");
            let uciMove = `${state.selectedSquare}${sq}`;
            // Auto queen promotion if legal
            if (legalMoves.includes(`${uciMove}q`)) {
              uciMove += "q";
            }
            sendWs({ type: "move", uci: uciMove });
            state.selectedSquare = null;
            renderMatch();
            return;
          }
          const hasMoves = legalMoves.some((uci) => uci.startsWith(sq));
          if (hasMoves) {
            haptic("light");
            state.selectedSquare = state.selectedSquare === sq ? null : sq;
          } else {
            state.selectedSquare = null;
          }
          renderMatch();
        });

        boardEl.appendChild(sqEl);
      }
    }
    container.appendChild(boardEl);
  }

  function renderOthelloBoard(container, room, myTurn) {
    const boardEl = document.createElement("div");
    boardEl.className = "othello-board";
    const legalSet = new Set((room.legal_moves || []).map(([r, c]) => `${r},${c}`));
    const last = room.state.last_move;

    room.state.board.forEach((row, r) => {
      row.forEach((cell, c) => {
        const el = document.createElement("div");
        el.className = "oth-cell";
        if (last && last[0] === r && last[1] === c) el.classList.add("last");

        if (cell) {
          el.innerHTML = `<div class="oth-disc ${cell}"></div>`;
        } else if (myTurn && legalSet.has(`${r},${c}`)) {
          el.innerHTML = `<div class="oth-hint"></div>`;
        }

        el.addEventListener("click", () => {
          if (!myTurn || !legalSet.has(`${r},${c}`)) return;
          haptic("light");
          sendWs({ type: "move", row: r, col: c });
        });
        boardEl.appendChild(el);
      });
    });
    container.appendChild(boardEl);
  }

  function renderConnect4Board(container, room, myTurn) {
    const boardEl = document.createElement("div");
    boardEl.className = "c4-board connect-board";
    room.state.board.forEach((row) => {
      row.forEach((cell, col) => {
        const cellEl = document.createElement("div");
        cellEl.className = `c4-cell ${cell ? "filled " + cell : "empty"}`;
        if (cell === "R" || cell === "Y") {
          cellEl.innerHTML = `<div class="c4-disc ${cell}"></div>`;
        }
        cellEl.addEventListener("click", () => {
          if (!myTurn) return;
          haptic("light");
          sendWs({ type: "move", col });
        });
        boardEl.appendChild(cellEl);
      });
    });
    container.appendChild(boardEl);
  }

  function get3dTicTacToePiece(type) {
    if (type === "X") {
      return `
        <svg class="ttt-3d-svg ttt-3d-x" viewBox="0 0 72 72">
          <defs>
            <filter id="tttXGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#0284c7" flood-opacity="0.65"/>
            </filter>
            <linearGradient id="tttXGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#38bdf8"/>
              <stop offset="50%" stop-color="#0284c7"/>
              <stop offset="100%" stop-color="#1e3a8a"/>
            </linearGradient>
            <linearGradient id="tttXShine" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9"/>
              <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <g transform="translate(0, 4)" opacity="0.6">
            <line x1="18" y1="18" x2="54" y2="54" stroke="#082f49" stroke-width="13" stroke-linecap="round"/>
            <line x1="54" y1="18" x2="18" y2="54" stroke="#082f49" stroke-width="13" stroke-linecap="round"/>
          </g>
          <g filter="url(#tttXGlow)">
            <line x1="18" y1="18" x2="54" y2="54" stroke="url(#tttXGrad)" stroke-width="11" stroke-linecap="round"/>
            <line x1="54" y1="18" x2="18" y2="54" stroke="url(#tttXGrad)" stroke-width="11" stroke-linecap="round"/>
            <line x1="20" y1="19" x2="52" y2="51" stroke="url(#tttXShine)" stroke-width="3" stroke-linecap="round"/>
            <line x1="52" y1="19" x2="20" y2="51" stroke="url(#tttXShine)" stroke-width="3" stroke-linecap="round"/>
          </g>
        </svg>`;
    }
    if (type === "O") {
      return `
        <svg class="ttt-3d-svg ttt-3d-o" viewBox="0 0 72 72">
          <defs>
            <filter id="tttOGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#ec4899" flood-opacity="0.65"/>
            </filter>
            <linearGradient id="tttOGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#fb7185"/>
              <stop offset="50%" stop-color="#ec4899"/>
              <stop offset="100%" stop-color="#9333ea"/>
            </linearGradient>
            <linearGradient id="tttOShine" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9"/>
              <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <circle cx="36" cy="40" r="20" fill="none" stroke="#581c87" stroke-width="12" opacity="0.6"/>
          <g filter="url(#tttOGlow)">
            <circle cx="36" cy="36" r="20" fill="none" stroke="url(#tttOGrad)" stroke-width="10.5"/>
            <circle cx="36" cy="34" r="19" fill="none" stroke="url(#tttOShine)" stroke-width="2.5"/>
          </g>
        </svg>`;
    }
    return "";
  }

  function renderTicTacToeBoard(container, room, myTurn) {
    const boardEl = document.createElement("div");
    boardEl.className = "ttt-board";
    room.state.board.forEach((cell, index) => {
      const cellEl = document.createElement("div");
      cellEl.className = "ttt-cell";
      if (cell) {
        cellEl.innerHTML = get3dTicTacToePiece(cell);
      }
      cellEl.addEventListener("click", () => {
        if (!myTurn || cell !== "") return;
        haptic("light");
        sendWs({ type: "move", index });
      });
      boardEl.appendChild(cellEl);
    });
    container.appendChild(boardEl);
  }

  async function loadLeaderboard() {
    const el = document.getElementById("leaderboardList");
    const res = await fetch(`/api/leaderboard?game_type=${encodeURIComponent(state.lbGame)}`);
    const data = await res.json();
    if (!data.players.length) {
      el.textContent = "No ranked matches completed yet for this category.";
      return;
    }
    el.innerHTML = data.players
      .map(
        (p, idx) => {
          const rankNum = idx + 1;
          const badgeEl = rankNum <= 6
            ? `<img src="/static/badges/badge_${rankNum}.png" class="lb-badge-icon" alt="#${rankNum}">`
            : `<span style="font-weight:700;color:var(--muted);margin-right:6px;">#${rankNum}</span>`;
          return `
      <div class="lb-row">
        <span>${badgeEl} ${p.tier?.icon || "🥉"} <strong>${p.display_name}</strong> (Lv${p.level || 1})</span>
        <span>${Math.round(p.elo)} ELO • ${p.wins}W/${p.losses}L</span>
      </div>`;
        }
      )
      .join("");
  }

  function selectGame(game) {
    state.selectedGame = game;
    document.querySelectorAll(".arena-mode-card, .game-pill").forEach((b) => {
      b.classList.toggle("selected", b.dataset.game === game);
    });
  }

  const arenaGamesMeta = {
    chess: {
      title: "Grandmaster Chess",
      tag: "Ranked 1v1 PvP Duel",
      icon: "♟️",
      thumb: "/static/thumbnails/chess_thumb.png",
      desc: "Full 8x8 tactical chess with piece validation & competitive ELO ratings!",
      timer: "⏱️ 3 MIN CLOCK",
    },
    connect4: {
      title: "Connect 4 Royale",
      tag: "Tactical Disc Drop Duel",
      icon: "🔴",
      thumb: "/static/thumbnails/connect4_thumb.png",
      desc: "Drop glowing discs and line up 4 horizontally, vertically, or diagonally!",
      timer: "⏱️ 30s PER MOVE",
    },
    tictactoe: {
      title: "XO Blitz Arena",
      tag: "Ultra-Fast 3x3 Showdown",
      icon: "❌",
      thumb: "/static/thumbnails/xo_thumb.png",
      desc: "Rapid 3x3 tactical duel with 5-second blitz turns and ranked ELO!",
      timer: "🔥 5s BLITZ",
    },
    othello: {
      title: "Othello Reversi",
      tag: "Tactical Flank & Flip Duel",
      icon: "⚫",
      thumb: "/static/thumbnails/othello_thumb.png",
      desc: "Outflank opposing discs, trap the 4 corners, and dominate the board!",
      timer: "⏱️ 60s PER MOVE",
    },
    knife_hit: {
      title: "Knife Master 3D",
      tag: "MPL Tournament Blitz",
      icon: "🗡️",
      thumb: "/static/thumbnails/knife_thumb.png",
      desc: "3-minute tournament speed run • 15+ escalating levels • avoid clashing blades!",
      timer: "⏱️ 3 MIN CLOCK",
    },
    fruit_slice: {
      title: "Fruit Slice Blade",
      tag: "MPL Tournament Slicer",
      icon: "🍉",
      thumb: "/static/thumbnails/fruit_thumb.png",
      desc: "3-minute blitz frenzy • 3 lives • swipe multi-combos and avoid deadly bombs!",
      timer: "🍉 3 LIVES • 3 MIN",
    },
    sheep_fight: {
      title: "Sheep Fight Royale",
      tag: "Hago 1v1 Battle Arena",
      icon: "🐑",
      thumb: "/static/thumbnails/sheep_thumb.png",
      desc: "Hago-style 5-lane sheep pushing battle! Deploy small, medium, and giant horned rams to push opponent into their barn!",
      timer: "⏱️ 90s MATCH",
    },
    virus_breaker: {
      title: "Virus Breaker",
      tag: "Hago 1v1 Cannon Arena",
      icon: "🦠",
      thumb: "/static/thumbnails/virus_thumb.png",
      desc: "Hago-style cannon shooter! Blast levitating jumping viruses, unlock multi-barrel shooters, and outscore your rival!",
      timer: "⏱️ 3 MIN BATTLE",
    },
  };

  function openArenaGameModal(gameKey) {
    selectGame(gameKey);
    const meta = arenaGamesMeta[gameKey] || arenaGamesMeta["chess"];
    const modal = document.getElementById("modalArenaMatchOptions");
    if (!modal) return;
    document.getElementById("arenaModalTitle").textContent = meta.title;
    document.getElementById("arenaModalTag").textContent = meta.tag;
    document.getElementById("arenaModalIcon").textContent = meta.icon;
    document.getElementById("arenaModalThumb").src = meta.thumb;
    document.getElementById("arenaModalDesc").textContent = meta.desc;
    document.getElementById("arenaModalTimer").textContent = meta.timer;
    const inputCode = document.getElementById("modalRoomCodeInput");
    if (inputCode) inputCode.value = "";
    modal.classList.remove("hidden");
    haptic("medium");
  }

  function closeArenaGameModal() {
    document.getElementById("modalArenaMatchOptions")?.classList.add("hidden");
  }

  // Bind arena mode selection cards to open pop-up options modal
  document.querySelectorAll(".arena-mode-card").forEach((card) => {
    card.addEventListener("click", () => {
      openArenaGameModal(card.dataset.game);
    });
  });

  document.getElementById("btnCloseArenaModal")?.addEventListener("click", closeArenaGameModal);
  document.getElementById("modalArenaMatchOptions")?.addEventListener("click", (e) => {
    if (e.target.id === "modalArenaMatchOptions") closeArenaGameModal();
  });

  document.getElementById("btnModalQuickMatch")?.addEventListener("click", () => {
    closeArenaGameModal();
    startRoomRequest({ quick_match: true });
  });

  document.getElementById("btnModalVsAi")?.addEventListener("click", () => {
    closeArenaGameModal();
    startRoomRequest({ vs_ai: true });
  });

  document.getElementById("btnModalCreateRoom")?.addEventListener("click", () => {
    closeArenaGameModal();
    startRoomRequest({ quick_match: false });
  });

  document.getElementById("btnModalJoinRoom")?.addEventListener("click", () => {
    const code = document.getElementById("modalRoomCodeInput")?.value.trim().toUpperCase();
    if (!code) {
      alert("Please enter a valid room code (e.g. A1B2)!");
      return;
    }
    closeArenaGameModal();
    joinRoom(code);
  });

  document.getElementById("modalRoomCodeInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      document.getElementById("btnModalJoinRoom")?.click();
    }
  });

  // Navigation
  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const v = item.dataset.view;
      if (v === "shop") return;
      state.prevView = v;
      showView(v);
      if (v === "home") refreshLiveRooms();
      if (v === "ranks") {
        loadLeaderboard();
        refreshProfileAndHistory();
      }
      if (v === "profile") refreshProfileAndHistory();
    });
  });

  document.querySelectorAll(".arena-game-card").forEach((card) => {
    card.addEventListener("click", () => {
      selectGame(card.dataset.game);
      state.prevView = "battle";
      showView("battle");
    });
  });

  document.querySelectorAll(".game-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectGame(btn.dataset.game);
      haptic("light");
    });
  });

  document.querySelectorAll(".filter-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-pill").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.lbGame = btn.dataset.game;
      loadLeaderboard();
    });
  });

  document.getElementById("btnQuickMatch")?.addEventListener("click", () => startRoomRequest({ quick_match: true }));
  document.getElementById("btnVsAi")?.addEventListener("click", () => startRoomRequest({ vs_ai: true }));
  document.getElementById("btnCreateRoom")?.addEventListener("click", () => startRoomRequest({ quick_match: false }));
  document.getElementById("btnJoinRoom")?.addEventListener("click", () => {
    const inp = document.getElementById("roomCodeInput");
    if (inp) joinRoom(inp.value);
  });

  document.getElementById("btnLeaveRoom")?.addEventListener("click", () => {
    teardownArenaIframe();
    if (state.ws) state.ws.close();
    if (state.clockTimer) clearInterval(state.clockTimer);
    showView(state.prevView || "home");
    refreshLiveRooms();
  });
  document.getElementById("btnLeaveRoomAlt")?.addEventListener("click", () => {
    document.getElementById("btnLeaveRoom")?.click();
  });

  document.getElementById("btnCopyInvite")?.addEventListener("click", async () => {
    if (!state.room) return;
    const code = state.room.room_id;
    const gameName = (state.room.game_type || "chess").toUpperCase().replace("_", " ");
    const shareUrl = state.botUsername
      ? `https://t.me/${state.botUsername}?startapp=room_${code}`
      : `${window.location.origin}/?room=${code}`;
    
    // In Telegram WebApp: open native Telegram share sheet to directly invite friends
    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(
        `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(`⚔️ Challenge me in ${gameName}! Tap to join my board directly:`)}`
      );
    } else {
      try {
        await navigator.clipboard.writeText(shareUrl);
        const btn = document.getElementById("btnCopyInvite");
        if (btn) {
          btn.textContent = "✅ Link Copied";
          setTimeout(() => { btn.textContent = "📤 Invite"; }, 1800);
        }
      } catch (_) {
        prompt("Copy this invite link to share:", shareUrl);
      }
    }
  });

  document.getElementById("btnResign")?.addEventListener("click", () => sendWs({ type: "resign" }));
  document.getElementById("btnRematch")?.addEventListener("click", () => sendWs({ type: "rematch" }));
  document.getElementById("btnResultRematch")?.addEventListener("click", () => {
    document.getElementById("modalMatchResult")?.classList.add("hidden");
    sendWs({ type: "rematch" });
  });
  document.getElementById("btnResultBack")?.addEventListener("click", () => {
    teardownArenaIframe();
    document.getElementById("modalMatchResult")?.classList.add("hidden");
    document.getElementById("btnLeaveRoom")?.click();
  });
  document.getElementById("btnRefreshLb")?.addEventListener("click", () => {
    loadLeaderboard();
    refreshProfileAndHistory();
  });
  document.getElementById("btnRefreshLive")?.addEventListener("click", refreshLiveRooms);
  document.getElementById("btnRefreshProfile")?.addEventListener("click", refreshProfileAndHistory);

  // In-game Match Chat Wiring
  document.getElementById("btnOpenMatchChat")?.addEventListener("click", () => {
    haptic("light");
    toggleMatchChat(true);
  });
  document.getElementById("btnCloseMatchChat")?.addEventListener("click", () => {
    toggleMatchChat(false);
  });
  document.getElementById("chatBackdrop")?.addEventListener("click", () => {
    toggleMatchChat(false);
  });
  document.getElementById("chatSendForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const inp = document.getElementById("chatInputText");
    if (!inp) return;
    const val = inp.value.trim();
    if (val) {
      haptic("light");
      sendMatchChat(val);
      inp.value = "";
    }
  });
  document.querySelectorAll(".qc-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      const msg = pill.dataset.msg;
      if (msg) {
        haptic("light");
        sendMatchChat(msg);
      }
    });
  });


  // Category & search filtering for 50+ HTML5 games
  function classifyGameCategory(g) {
    const t = `${g.title} ${g.description}`.toLowerCase();
    if (/puzzle|wordle|sudoku|minesweeper|2048|crossword|nonogram|hanoi|flood|matrix|memory|hextris|15 puzzle/.test(t)) return "puzzle";
    if (/sport|billiards|pool|pong|golf|soccer|basketball|hockey|tennis/.test(t)) return "sport";
    if (/arcade|pac-man|pacman|dino|flappy|jump|tower|breakout|invaders|asteroids|snake|pinball|duck|mole|geometry|fruit|knife|slither|paper|helix|plinko|virus|cannon/.test(t)) return "arcade";
    if (/solitaire|card|mahjong|checkers|reversi|othello|backgammon|domino|yahtzee|hearts|spades|rummy|cribbage|freecell/.test(t)) return "cards";
    return "casual";
  }

  function getEffectiveGameImage(g) {
    if (!g) return "";
    const localLogo = localStorage.getItem("game_logo_" + (g.url || "")) || localStorage.getItem("game_logo_" + (g.title || ""));
    if (localLogo && localLogo.trim()) return localLogo;
    return g.image_url || "";
  }

  function makeGameCardHtml(g) {
    const img = getEffectiveGameImage(g);
    return `
      <button class="custom-game-card" data-url="${encodeURI(g.url)}" data-title="${g.title}" data-icon="${g.icon}">
        <div class="cgc-top">
          <div class="cgc-icon">
            ${img ? `<img src="${img}" class="cgc-box-img" alt="${g.title}" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline-block';" /><span class="cgc-fallback-emoji" style="display:none;">${g.icon || "🎮"}</span>` : (g.icon || "🎮")}
          </div>
          <span class="cgc-play-badge">PLAY</span>
        </div>
        <div class="cgc-body">
          <div class="cgc-title">${g.title}</div>
          <div class="cgc-desc">${g.description || "Tap to play instantly"}</div>
        </div>
      </button>`;
  }

  function getGameKey(g) {
    if (!g) return "";
    const u = (g.url || "").trim().toLowerCase().replace(/\/+$/, "");
    const t = (g.title || "").trim().toLowerCase();
    return u || t;
  }

  function getUniqueGamesList() {
    const seen = new Set();
    return (state.allCustomGames || []).filter(g => {
      const k = getGameKey(g);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function renderFilteredGames() {
    const el = document.getElementById("customGamesGrid");
    if (!el) return;
    const cat = state.gameFilterCat || "all";
    const q = (state.gameSearchQuery || "").toLowerCase().trim();

    const uniqueGames = getUniqueGamesList();
    const countEl = document.getElementById("totalGamesCount");
    if (countEl) countEl.textContent = `${uniqueGames.length}`;

    // If searching or filtering by a specific category, display standard filtered grid
    if (q || cat !== "all") {
      const filtered = uniqueGames.filter((g) => {
        const matchCat = cat === "all" || classifyGameCategory(g) === cat;
        const matchQ = !q || g.title.toLowerCase().includes(q) || (g.description && g.description.toLowerCase().includes(q));
        return matchCat && matchQ;
      });

      if (!filtered.length) {
        el.className = "custom-games-grid";
        el.innerHTML = `
          <div class="empty-games-hint">
            No games found matching "${q}". Try another search keyword!
          </div>`;
        return;
      }

      el.className = "custom-games-grid";
      el.innerHTML = filtered.map(makeGameCardHtml).join("");
    } else {
      // Categorized sections in Arcade view ("different sections of games instead of one list")
      const sections = [
        {
          icon: "⚡",
          theme: "featured",
          title: "Featured & High-Stakes",
          matcher: (g) => /aviator|flipster|space race|sheep fight/i.test(g.title)
        },
        {
          icon: "🚀",
          theme: "action",
          title: "Action & Endless Adventures",
          matcher: (g) => /chintu|mario|dino|space invaders|snake/i.test(g.title)
        },
        {
          icon: "⚔️",
          theme: "pvp",
          title: "PvP & Reflex Battles",
          matcher: (g) => /knife|fruit|whack|pong|typer/i.test(g.title)
        },
        {
          icon: "🧱",
          theme: "tower",
          title: "Tower & Block Physics",
          matcher: (g) => /tower|helix|tetris|breakout|pinball/i.test(g.title)
        },
        {
          icon: "🧩",
          theme: "puzzle",
          title: "Puzzle & Brain Challenge",
          matcher: (g) => /roll the ball|2048|wordle|sudoku|puzzle|flood|memory|simon/i.test(g.title)
        },
        {
          icon: "🃏",
          theme: "cards",
          title: "Cards & Tabletop Classics",
          matcher: (g) => /uno|connect 4|billiards|checkers|tic-tac-toe|solitaire/i.test(g.title)
        }
      ];

      const assigned = new Set();
      let html = "";

      sections.forEach(sec => {
        // Exclude games already assigned to any prior section to strictly prevent duplicates
        const secGames = uniqueGames.filter(g => {
          const k = getGameKey(g);
          if (assigned.has(k)) return false;
          return sec.matcher(g);
        });
        secGames.forEach(g => assigned.add(getGameKey(g)));
        if (secGames.length > 0) {
          html += `
            <div class="arcade-category-section">
              <div class="arcade-section-header">
                <div class="ash-left">
                  <div class="ash-icon-badge ash-theme-${sec.theme}">
                    <span class="ash-icon-anim">${sec.icon}</span>
                  </div>
                  <span class="ash-title">${sec.title}</span>
                </div>
                <span class="ash-badge">${secGames.length} games</span>
              </div>
              <div class="custom-games-grid">
                ${secGames.map(makeGameCardHtml).join("")}
              </div>
            </div>
          `;
        }
      });

      const moreGames = uniqueGames.filter(g => !assigned.has(getGameKey(g)));
      if (moreGames.length > 0) {
        html += `
          <div class="arcade-category-section">
            <div class="arcade-section-header">
              <div class="ash-left">
                <div class="ash-icon-badge ash-theme-arcade">
                  <span class="ash-icon-anim">🎮</span>
                </div>
                <span class="ash-title">More Arcade Fun</span>
              </div>
              <span class="ash-badge">${moreGames.length} games</span>
            </div>
            <div class="custom-games-grid">
              ${moreGames.map(makeGameCardHtml).join("")}
            </div>
          </div>
        `;
      }

      el.className = "arcade-sections-container";
      el.innerHTML = html;
    }

    el.querySelectorAll(".custom-game-card").forEach((card) => {
      card.addEventListener("click", () => {
        haptic("medium");
        launchWebGame(card.dataset.title, card.dataset.url, card.dataset.icon);
      });
    });
  }

  const searchInput = document.getElementById("inputGameSearch");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.gameSearchQuery = e.target.value;
      renderFilteredGames();
    });
  }

  document.querySelectorAll(".cat-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      haptic("light");
      document.querySelectorAll(".cat-pill").forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      state.gameFilterCat = pill.dataset.cat || "all";
      renderFilteredGames();
    });
  });

  function renderContinuePlayingCarousel() {
    const row = document.getElementById("continuePlayingRow");
    if (!row) return;
    const games = state.allCustomGames || [];
    if (!games.length) return;

    // Pick top games for the carousel
    const pickTitles = ["Flipster Multiplier", "Retro Tetris", "Fruit Slicer", "Knife Master", "Helix Drop", "Space Invaders", "Neon Snake", "2048 Classic", "8-Ball Billiards"];
    const picks = games.filter(g => pickTitles.some(t => g.title.toLowerCase().includes(t.toLowerCase()))).slice(0, 8);
    const displayList = picks.length >= 4 ? picks : games.slice(0, 8);

    row.innerHTML = displayList.map(g => {
      const img = getEffectiveGameImage(g);
      return `
      <button class="carousel-game-card" data-url="${encodeURI(g.url)}" data-title="${g.title}" data-icon="${g.icon}">
        <div class="cgc-thumb-wrap">
          ${img ? `<img src="${img}" class="cgc-thumb-img" alt="${g.title}" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline-block';" /><span class="cgc-art" style="display:none;">${g.icon || "🎮"}</span>` : `<span class="cgc-art">${g.icon || "🎮"}</span>`}
        </div>
        <div class="cgc-card-title">${g.title}</div>
        <div class="cgc-card-tag">${classifyGameCategory(g).toUpperCase()}</div>
      </button>
    `;
    }).join("");

    row.querySelectorAll(".carousel-game-card").forEach(btn => {
      btn.addEventListener("click", () => {
        haptic("medium");
        launchWebGame(btn.dataset.title, btn.dataset.url, btn.dataset.icon);
      });
    });
  }

  function renderTrendingGamesList() {
    const list = document.getElementById("trendingGamesList");
    if (!list) return;
    const games = state.allCustomGames || [];
    if (!games.length) return;

    // Featured trending picks
    const trendingList = games.slice(1, 6);
    const missions = [
      "Next: Score 320 points",
      "Next: Clear 3 stages",
      "Next: Survive 60 seconds",
      "Next: Win 2 consecutive rounds",
      "Next: Beat personal high score"
    ];

    list.innerHTML = trendingList.map((g, idx) => {
      const img = getEffectiveGameImage(g);
      return `
      <div class="trending-game-card" data-url="${encodeURI(g.url)}" data-title="${g.title}" data-icon="${g.icon}">
        <div class="tgc-left">
          <div class="tgc-thumb">
            ${img ? `<img src="${img}" class="tgc-thumb-img" alt="${g.title}" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline-block';" /><span class="tgc-fallback-emoji" style="display:none;">${g.icon || "🎮"}</span>` : (g.icon || "🎮")}
          </div>
          <div class="tgc-info">
            <div class="tgc-title">${g.title}</div>
            <div class="tgc-mission">${missions[idx % missions.length]}</div>
            <div class="tgc-dots">
              <span class="tdot active"></span>
              <span class="tdot active"></span>
              <span class="tdot"></span>
              <span class="tdot"></span>
            </div>
          </div>
        </div>
        <button class="btn-trending-play">PLAY</button>
      </div>
    `;
    }).join("");

    list.querySelectorAll(".trending-game-card").forEach(card => {
      card.addEventListener("click", () => {
        haptic("medium");
        launchWebGame(card.dataset.title, card.dataset.url, card.dataset.icon);
      });
    });
  }

  // View All buttons navigation & focus
  document.getElementById("linkViewAllQuests")?.addEventListener("click", () => {
    haptic("light");
    const qEl = document.getElementById("activeQuestCard");
    if (qEl) {
      qEl.scrollIntoView({ behavior: "smooth", block: "center" });
      qEl.classList.add("highlight-pulse");
      setTimeout(() => qEl.classList.remove("highlight-pulse"), 1200);
    }
  });

  document.getElementById("linkViewAllContinue")?.addEventListener("click", () => {
    haptic("light");
    document.getElementById("sectionAllGames")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.getElementById("linkViewAllTournaments")?.addEventListener("click", () => {
    haptic("light");
    showView("battle");
  });

  document.getElementById("linkViewAllTrending")?.addEventListener("click", () => {
    haptic("light");
    document.getElementById("sectionAllGames")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.querySelectorAll(".chunky-cat-card").forEach((card) => {
    card.addEventListener("click", () => {
      haptic("light");
      const cat = card.dataset.cat;
      if (cat) {
        state.gameFilterCat = cat;
        document.querySelectorAll(".cat-filter-btn").forEach((b) => {
          b.classList.toggle("active", b.dataset.cat === cat);
        });
        renderFilteredGames();
        document.getElementById("sectionAllGames")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });

  const FALLBACK_DEFAULT_GAMES = [
    { title: "Aviator Rocket", url: "/static/games/aviator/index.html", icon: "🚀", description: "High-stakes rocket multiplier curve! Cash out before blast", image_url: "/static/thumbnails/aviator_thumb.png" },
    { title: "Neon Snake 3D", url: "/static/games/snake/index.html", icon: "🐍", description: "3D cyber slither with glowing energy crystals", image_url: "/static/thumbnails/snake_thumb.png" },
    { title: "Brick Breaker", url: "/static/games/breakout/index.html", icon: "🧱", description: "Smash neon bricks with bouncing ball", image_url: "" },
    { title: "Retro Tetris", url: "/static/games/tetris/index.html", icon: "🧩", description: "Falling tetromino block puzzle", image_url: "/static/banners/tetris_promo.png" },
    { title: "T-Rex Cyber Run", url: "/static/games/dino/index.html", icon: "🦖", description: "3D-style endless neon desert runner with energy pickups", image_url: "/static/thumbnails/dino_thumb.png" },
    { title: "Neon Pong", url: "/static/games/pong/index.html", icon: "🏓", description: "Fast table tennis rally against AI", image_url: "" },
    { title: "Galaxy Defender 3D", url: "/static/games/space_invaders/index.html", icon: "🚀", description: "3D space fighter starship blasting alien swarms", image_url: "/static/thumbnails/galaxy_thumb.png" },
    { title: "Fruit Slicer", url: "/static/games/fruit_slice/index.html", icon: "🍉", description: "Slice flying fruits with swipe blades", image_url: "/static/thumbnails/fruit_thumb.png" },
    { title: "Knife Master", url: "/static/games/knife_hit/index.html", icon: "🗡️", description: "Throw knives into rotating target log", image_url: "/static/thumbnails/knife_thumb.png" },
    { title: "Sheep Fight Royale", url: "/static/games/sheep_fight/index.html", icon: "🐑", description: "Hago 1v1 sheep pushing battle arena", image_url: "/static/thumbnails/sheep_thumb.png" },
    { title: "Whack-a-Ghost", url: "/static/games/whack_a_mole/index.html", icon: "🔨", description: "Test reaction time whacking popping ghosts", image_url: "" },
    { title: "Helix Drop", url: "/static/games/helix_jump/index.html", icon: "🌀", description: "Bounce ball through gaps in rotating tower", image_url: "" },
    { title: "Tower Stack", url: "/static/games/tower_stack/index.html", icon: "🏢", description: "Slice and stack tower blocks as high as you can", image_url: "" },
    { title: "Neon Pinball", url: "/static/games/pinball/index.html", icon: "🪩", description: "Arcade pinball with flippers & bumpers", image_url: "" },
    { title: "Space Race", url: "/static/games/space_race/index.html", icon: "🚀", description: "Shoot asteroid obstacles & upgrade spaceship stats", image_url: "/static/thumbnails/space_race_thumb.png" },
    { title: "Chintu's Royal Run", url: "/static/games/indian_mario/index.html", icon: "👳", description: "Indian Mario platformer with spicy chili attacks & laddoos", image_url: "/static/thumbnails/indian_mario_thumb.png" },
    { title: "Plinko Fortune", url: "/static/games/plinko/index.html", icon: "🪙", description: "Lucky drop coin board with 100x center jackpot", image_url: "/static/thumbnails/plinko_thumb.png" },
    { title: "Virus Breaker", url: "/static/games/virus_breaker/index.html", icon: "👾", description: "Modern spaceship blaster popping bouncing virus swarms", image_url: "/static/thumbnails/virus_thumb.png" },
    { title: "Roll the Ball", url: "/static/games/roll_ball/index.html", icon: "🪵", description: "Slide wooden track tiles to roll ball into goal", image_url: "/static/thumbnails/roll_ball_thumb.png" },
    { title: "2048 Classic", url: "/static/games/2048/index.html", icon: "🔢", description: "Slide tiles to merge and reach 2048!", image_url: "/static/banners/puzzle2048_promo.png" },
    { title: "Wordle Guess", url: "/static/games/wordle/index.html", icon: "🟩", description: "Guess secret 5-letter word in 6 attempts", image_url: "" },
    { title: "Sudoku Master", url: "/static/games/sudoku/index.html", icon: "🧩", description: "Classic 9x9 number placement logic grid", image_url: "" },
    { title: "15-Puzzle Slider", url: "/static/games/sliding_puzzle/index.html", icon: "🔟", description: "Classic sliding numbered block puzzle", image_url: "" },
    { title: "Color Flood", url: "/static/games/color_flood/index.html", icon: "🎨", description: "Flood-fill the board with one color", image_url: "" },
    { title: "Emoji Memory", url: "/static/games/memory/index.html", icon: "🧠", description: "Flip and match pairs of hidden cards", image_url: "" },
    { title: "Simon Memory", url: "/static/games/simon/index.html", icon: "🔔", description: "Repeat growing sequence of lights & sounds", image_url: "" },
    { title: "UNO Classic Arena", url: "/static/games/uno/index.html", icon: "🃏", description: "Classic 1v1 UNO card battle against AI with wild cards", image_url: "/static/thumbnails/uno_thumb.png" },
    { title: "8-Ball Billiards", url: "/static/games/billiards/index.html", icon: "🎱", description: "Pocket balls with realistic pool physics", image_url: "" },
    { title: "Connect 4 Arena", url: "/static/games/connect4/index.html", icon: "🔴", description: "Align 4 chips in a row against AI", image_url: "/static/thumbnails/connect4_thumb.png" },
    { title: "Checkers Classic", url: "/static/games/checkers/index.html", icon: "⚪", description: "Jump and capture enemy checkers to king", image_url: "" },
    { title: "Neon Tic-Tac-Toe", url: "/static/games/tictactoe/index.html", icon: "❌", description: "Glowing neon 3x3 XO against unbeatable AI", image_url: "/static/thumbnails/xo_thumb.png" },
    { title: "Klondike Solitaire", url: "/static/games/solitaire/index.html", icon: "🃏", description: "World's most popular single-player card game", image_url: "" },
    { title: "Cyber Speed Typer", url: "/static/games/speed_typer/index.html", icon: "⌨️", description: "Test and improve your words-per-minute typing", image_url: "" },
  ];

  // Try initializing immediately with cached games or all 31 defaults
  try {
    const cached = localStorage.getItem("cached_custom_games");
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length >= 10) {
        state.allCustomGames = parsed;
      }
    }
  } catch (_) {}
  if (!state.allCustomGames || !state.allCustomGames.length) {
    state.allCustomGames = FALLBACK_DEFAULT_GAMES;
  }

  async function loadCustomGames() {
    const el = document.getElementById("customGamesGrid");
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const res = await fetch("/api/custom-games", { signal: controller.signal });
      clearTimeout(timer);
      const data = await res.json();
      const rawGames = (data.games && data.games.length) ? data.games : (state.allCustomGames || FALLBACK_DEFAULT_GAMES);
      const combined = [...rawGames];
      const existingUrls = new Set(combined.map(g => (g.url || "").trim().toLowerCase()));
      for (const fallback of FALLBACK_DEFAULT_GAMES) {
        const u = (fallback.url || "").trim().toLowerCase();
        if (!existingUrls.has(u)) {
          combined.push(fallback);
          existingUrls.add(u);
        }
      }
      const seenF = new Set();
      state.allCustomGames = combined.filter(g => {
        const k = ((g.url || "") + "::" + (g.title || "")).trim().toLowerCase();
        if (seenF.has(k)) return false;
        seenF.add(k);
        return true;
      });
      try {
        localStorage.setItem("cached_custom_games", JSON.stringify(state.allCustomGames));
      } catch (_) {}
    } catch (_) {
      if (!state.allCustomGames || !state.allCustomGames.length) {
        state.allCustomGames = FALLBACK_DEFAULT_GAMES;
      }
    }

    renderFilteredGames();
    renderContinuePlayingCarousel();
    renderTrendingGamesList();

    if (window.lucide) {
      setTimeout(() => { window.lucide.createIcons(); }, 20);
    }

    // Check if user launched via Telegram bot /aviator or /flipster command
    const urlParams = new URLSearchParams(window.location.search);
    const targetGame = urlParams.get("game");
    if (targetGame === "aviator" || targetGame === "flipster") {
      const aviator = (state.allCustomGames || []).find(g => g.title.toLowerCase().includes("aviator") || g.title.toLowerCase().includes("flipster"));
      if (aviator) {
        launchWebGame(aviator.title, aviator.url, aviator.icon);
      } else {
        launchWebGame("Aviator Rocket", "/static/games/aviator/index.html", "🚀");
      }
    }
  }

  function destroyGameIframe() {
    const oldIframe = document.getElementById("customGameIframe");
    if (oldIframe) {
      try {
        oldIframe.contentWindow?.postMessage({ type: "PAUSE_GAME", action: "destroy" }, "*");
        oldIframe.contentWindow?.postMessage({ type: "PAUSE_GAME", action: "pause" }, "*");
      } catch (_) {}
      oldIframe.src = "about:blank";
      oldIframe.remove();
    }
  }

  function createFreshGameIframe() {
    destroyGameIframe();
    const container = document.getElementById("view-player");
    if (!container) return null;
    const iframe = document.createElement("iframe");
    iframe.id = "customGameIframe";
    iframe.src = "about:blank";
    iframe.allow = "autoplay; fullscreen; gamepad";
    iframe.allowFullscreen = true;
    iframe.style.opacity = "0";
    iframe.style.transition = "opacity 0.22s ease";
    container.appendChild(iframe);
    return iframe;
  }

  function exitGameToHome() {
    destroyGameIframe();
    state.currentGameUrl = "";
    document.getElementById("playerPauseOverlay")?.classList.add("hidden");
    document.getElementById("gamePlayerLoader")?.classList.add("hidden");
    try { tg?.exitFullscreen?.(); } catch (_) {}
    try { tg?.BackButton?.hide?.(); } catch (_) {}
    showView("home");
  }

  function playStartChime() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const t = ctx.currentTime;
      [523.25, 659.25, 783.99].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, t + idx * 0.08);
        g.gain.setValueAtTime(0.2, t + idx * 0.08);
        g.gain.linearRampToValueAtTime(0.01, t + idx * 0.08 + 0.14);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(t + idx * 0.08);
        osc.stop(t + idx * 0.08 + 0.14);
      });
    } catch (_) {}
  }

  function playGameOverDefeatSound() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const t = ctx.currentTime;
      [349.23, 311.13, 261.63, 196.0].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(freq, t + idx * 0.12);
        g.gain.setValueAtTime(0.3, t + idx * 0.12);
        g.gain.linearRampToValueAtTime(0.01, t + idx * 0.12 + 0.22);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(t + idx * 0.12);
        osc.stop(t + idx * 0.12 + 0.22);
      });
    } catch (_) {}
  }

  function launchWebGame(title, url, icon = "🎮") {
    state.currentGameUrl = url;
    const titleEl = document.getElementById("gamePlayerTitle");
    if (titleEl) titleEl.textContent = `${title}`;
    const pauseTitle = document.getElementById("pauseGameName");
    if (pauseTitle) pauseTitle.textContent = `${title}`;

    // Hide any lingering pause or loader overlay
    document.getElementById("playerPauseOverlay")?.classList.add("hidden");
    document.getElementById("gamePlayerLoader")?.classList.add("hidden");

    // Completely destroy and recreate iframe so ZERO pixels from the previous game can ever show!
    createFreshGameIframe();

    // Show Pre-Game Start Modal Pop-Up
    const pso = document.getElementById("playerStartOverlay");
    const psoIcon = document.getElementById("psoIcon");
    const psoTitle = document.getElementById("psoTitle");
    const psoSub = document.getElementById("psoSubtitle");
    if (pso) {
      if (psoIcon) psoIcon.textContent = icon || "🎮";
      if (psoTitle) psoTitle.textContent = title;
      if (psoSub) {
        if (title.toLowerCase().includes("fruit")) {
          psoSub.textContent = "🍉 Endless Survival • Slice Fruits & Combos • 3 Lives • AVOID BOMBS!";
        } else if (title.toLowerCase().includes("knife")) {
          psoSub.textContent = "🗡️ 3 Lives • Hit rotating target • Don't clash blades • 15+ Levels!";
        } else {
          psoSub.textContent = "Compete for tournament high scores, earn coins & climb global ranks!";
        }
      }
      pso.classList.remove("hidden");
    }

    state.prevView = "home";
    showView("player");
    try {
      tg?.expand?.();
      tg?.requestFullscreen?.();
    } catch (_) {}
    try {
      if (tg?.BackButton) {
        tg.BackButton.show();
        tg.BackButton.onClick(exitGameToHome);
      }
    } catch (_) {}
  }

  // Pre-game Start Button click
  document.getElementById("btnPsoStart")?.addEventListener("click", () => {
    haptic("medium");
    playStartChime();
    const pso = document.getElementById("playerStartOverlay");
    if (pso) pso.classList.add("hidden");

    let iframe = document.getElementById("customGameIframe");
    if (!iframe) {
      iframe = createFreshGameIframe();
    }

    const loader = document.getElementById("gamePlayerLoader");
    const loaderText = document.getElementById("gplText");
    if (loaderText) loaderText.textContent = "Launching Game...";
    if (loader) loader.classList.remove("hidden");

    if (iframe && state.currentGameUrl) {
      iframe.onload = () => {
        if (loader) loader.classList.add("hidden");
        iframe.style.opacity = "1";
      };
      iframe.src = state.currentGameUrl;
    }
  });

  // In-Game Pause System
  const btnPauseGame = document.getElementById("btnPauseGamePlayer");
  const pauseOverlay = document.getElementById("playerPauseOverlay");
  const btnResumeGame = document.getElementById("btnResumeGame");
  const btnRestartGameInPlayer = document.getElementById("btnRestartGameInPlayer");
  const btnExitGameFromPause = document.getElementById("btnExitGameFromPause");

  function openPlayerPauseOverlay() {
    haptic("light");
    pauseOverlay?.classList.remove("hidden");
    const iframe = document.getElementById("customGameIframe");
    try {
      iframe?.contentWindow?.postMessage({ type: "PAUSE_GAME", action: "pause" }, "*");
    } catch (_) {}
  }

  btnPauseGame?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPlayerPauseOverlay();
  });

  btnResumeGame?.addEventListener("click", () => {
    haptic("light");
    pauseOverlay?.classList.add("hidden");
    const iframe = document.getElementById("customGameIframe");
    try {
      iframe?.contentWindow?.postMessage({ type: "RESUME_GAME", action: "resume" }, "*");
    } catch (_) {}
  });

  btnRestartGameInPlayer?.addEventListener("click", () => {
    haptic("medium");
    pauseOverlay?.classList.add("hidden");
    const iframe = createFreshGameIframe();
    const loader = document.getElementById("gamePlayerLoader");
    if (loader) loader.classList.remove("hidden");
    if (iframe && state.currentGameUrl) {
      iframe.onload = () => {
        if (loader) loader.classList.add("hidden");
        iframe.style.opacity = "1";
      };
      iframe.src = state.currentGameUrl;
    }
  });

  btnExitGameFromPause?.addEventListener("click", () => {
    pauseOverlay?.classList.add("hidden");
    exitGameToHome();
  });

  // Hero Sliding Window Carousel Control (Dynamic with Admin Manager)
  let heroCurrentSlide = 0;
  let heroTotalSlides = 4;
  let heroAutoSlideInterval = null;

  function setHeroSlide(idx) {
    if (heroTotalSlides <= 0) return;
    heroCurrentSlide = (idx + heroTotalSlides) % heroTotalSlides;
    const wrapper = document.getElementById("heroSlidesWrapper");
    if (wrapper) {
      wrapper.style.transform = `translateX(-${heroCurrentSlide * 100}%)`;
    }
    document.querySelectorAll(".carousel-dot").forEach((dot, dIdx) => {
      dot.classList.toggle("active", dIdx === heroCurrentSlide);
    });
  }

  // Smooth touch swipe support for mobile & Telegram
  const heroCarouselEl = document.getElementById("heroCarousel");
  if (heroCarouselEl) {
    let startX = 0;
    let endX = 0;
    heroCarouselEl.addEventListener("touchstart", (e) => {
      startX = e.touches[0].clientX;
      if (heroAutoSlideInterval) clearInterval(heroAutoSlideInterval);
    }, { passive: true });

    heroCarouselEl.addEventListener("touchend", (e) => {
      endX = e.changedTouches[0].clientX;
      const diff = endX - startX;
      if (Math.abs(diff) > 35) {
        if (diff < 0) {
          setHeroSlide(heroCurrentSlide + 1);
        } else {
          setHeroSlide(heroCurrentSlide - 1);
        }
      }
      startHeroAutoSlide();
    }, { passive: true });
  }

  window.addEventListener("resize", () => {
    setHeroSlide(heroCurrentSlide);
  });

  function startHeroAutoSlide() {
    if (heroAutoSlideInterval) clearInterval(heroAutoSlideInterval);
    if (heroTotalSlides <= 1) return;
    heroAutoSlideInterval = setInterval(() => {
      setHeroSlide(heroCurrentSlide + 1);
    }, 4500);
  }

  function bindDefaultHeroButtons() {
    document.getElementById("btnPlayAviatorHero")?.addEventListener("click", () => {
      haptic("heavy");
      launchWebGame("Aviator Rocket", "/static/games/aviator/index.html", "🚀");
    });
    document.getElementById("btnPlaySpeedwayHero")?.addEventListener("click", () => {
      haptic("heavy");
      launchWebGame("T-Rex Cyber Run", "/static/games/dino/index.html", "🦖");
    });
    document.getElementById("btnPlayInvadersHero")?.addEventListener("click", () => {
      haptic("heavy");
      launchWebGame("Galaxy Defender 3D", "/static/games/space_invaders/index.html", "🚀");
    });
    document.getElementById("btnPlayTetrisHero")?.addEventListener("click", () => {
      haptic("heavy");
      launchWebGame("Retro Tetris", "/static/games/tetris/index.html", "🧩");
    });

    document.querySelectorAll("#carouselDots .carousel-dot").forEach((dot, idx) => {
      dot.addEventListener("click", () => {
        haptic("light");
        setHeroSlide(idx);
        startHeroAutoSlide();
      });
    });

    // Sync custom logos to default slides if available
    const aviatorLogo = localStorage.getItem("game_logo_/static/games/aviator/index.html") || localStorage.getItem("game_logo_Aviator Rocket");
    const dinoLogo = localStorage.getItem("game_logo_/static/games/dino/index.html") || localStorage.getItem("game_logo_T-Rex Cyber Run");
    const spaceLogo = localStorage.getItem("game_logo_/static/games/space_invaders/index.html") || localStorage.getItem("game_logo_Galaxy Defender 3D");
    const tetrisLogo = localStorage.getItem("game_logo_/static/games/tetris/index.html") || localStorage.getItem("game_logo_Retro Tetris");

    const slides = document.querySelectorAll("#heroSlidesWrapper .hero-slide");
    if (slides[0] && aviatorLogo) slides[0].querySelector("img")?.setAttribute("src", aviatorLogo);
    if (slides[1] && dinoLogo) slides[1].querySelector("img")?.setAttribute("src", dinoLogo);
    if (slides[2] && spaceLogo) slides[2].querySelector("img")?.setAttribute("src", spaceLogo);
    if (slides[3] && tetrisLogo) slides[3].querySelector("img")?.setAttribute("src", tetrisLogo);
  }

  bindDefaultHeroButtons();
  startHeroAutoSlide();

  async function loadHeroCarouselBanners() {
    const wrapper = document.getElementById("heroSlidesWrapper");
    const dotsWrap = document.querySelector(".carousel-nav-dots");
    if (!wrapper) return;

    try {
      const res = await fetch("/api/promo-banners");
      if (!res.ok) return;
      const data = await res.json();
      const DEFAULT_HERO_BANNERS = [
        {
          title: "Aviator Crash",
          description: "Multiply your coin balance before the rocket bursts!",
          badge: "HOT 🔥",
          badge2: "x1000",
          bg_theme: "slide-aviator",
          game_title: "Aviator Rocket",
          game_url: "/static/games/aviator/index.html",
          game_icon: "🚀",
          image_url: "/static/banners/aviator_promo.png"
        },
        {
          title: "T-Rex Cyber Run",
          description: "Infinite cyberpunk hurdle runner with high-speed neon ramps!",
          badge: "FEATURED 🦖",
          badge2: "SPEEDWAY",
          bg_theme: "slide-speedway",
          game_title: "T-Rex Cyber Run",
          game_url: "/static/games/dino/index.html",
          game_icon: "🦖",
          image_url: "/static/banners/dino_promo.png"
        },
        {
          title: "Galaxy Defender",
          description: "Classic neon 3D retro space shooter action with boss fights!",
          badge: "ARCADE 👾",
          badge2: "BOSS RAID",
          bg_theme: "slide-invaders",
          game_title: "Galaxy Defender 3D",
          game_url: "/static/games/space_invaders/index.html",
          game_icon: "👾",
          image_url: "/static/banners/space_promo.png"
        },
        {
          title: "Retro Tetris",
          description: "Classic block-clearing arcade puzzle with glowing neon lines!",
          badge: "PUZZLE 🧩",
          badge2: "CLASSIC",
          bg_theme: "slide-tetris",
          game_title: "Retro Tetris",
          game_url: "/static/games/tetris/index.html",
          game_icon: "🧩",
          image_url: "/static/banners/tetris_promo.png"
        }
      ];

      const banners = (data.banners && data.banners.length) ? data.banners : DEFAULT_HERO_BANNERS;

      heroTotalSlides = banners.length;
      wrapper.innerHTML = "";
      if (dotsWrap) dotsWrap.innerHTML = "";

      banners.forEach((b, idx) => {
        const theme = b.bg_theme || "slide-aviator";
        let glowClass = "red-glow";
        let ctaClass = "red-cta";
        let ctaIcon = "rocket";
        if (theme.includes("speedway") || theme.includes("blue")) { glowClass = "blue-glow"; ctaClass = "blue-cta"; ctaIcon = "gauge"; }
        else if (theme.includes("invaders") || theme.includes("purple")) { glowClass = "purple-glow"; ctaClass = "purple-cta"; ctaIcon = "shield"; }
        else if (theme.includes("tetris") || theme.includes("green")) { glowClass = "green-glow"; ctaClass = "green-cta"; ctaIcon = "boxes"; }
        else if (theme.includes("gold")) { glowClass = "gold-glow"; ctaClass = "gold-cta"; ctaIcon = "trophy"; }
        else if (theme.includes("cyan")) { glowClass = "cyan-glow"; ctaClass = "cyan-cta"; ctaIcon = "zap"; }
        else { ctaIcon = "play"; }

        // Live artwork: use custom local logo if updated, else banner image_url, or fallback to game_current_image
        const localLogo = localStorage.getItem("game_logo_" + (b.game_url || "")) || localStorage.getItem("game_logo_" + (b.game_title || ""));
        const artSrc = (localLogo && localLogo.trim()) || b.image_url || b.game_current_image || "/static/banners/welcome_banner.jpg";

        const slide = document.createElement("div");
        slide.className = `hero-slide ${idx === 0 ? "active" : ""}`;
        slide.dataset.slide = idx;
        slide.innerHTML = `
          <div class="hero-feature-card ${theme}">
            <div class="hero-feature-glow ${glowClass}"></div>
            <div class="hero-feature-body">
              <div class="hero-feature-content">
                <div class="hero-badge-row">
                  ${b.badge ? `<span class="hero-badge featured">${escapeHtml(b.badge)}</span>` : ""}
                  ${b.badge2 ? `<span class="hero-badge live">${escapeHtml(b.badge2)}</span>` : ""}
                </div>
                <div class="hero-feature-title">${escapeHtml(b.title)}</div>
                <div class="hero-feature-desc">${escapeHtml(b.description || "")}</div>
                <div class="hero-feature-cta-row">
                  <button class="btn-hero-play ${ctaClass}" data-url="${escapeHtml(b.game_url)}" data-title="${escapeHtml(b.game_title || b.title)}" data-icon="${escapeHtml(b.game_icon || "🎮")}">
                    <i data-lucide="${ctaIcon}" class="lucide-sm"></i> PLAY NOW
                  </button>
                </div>
              </div>
              <div class="hero-feature-visual">
                <img src="${artSrc}" alt="${escapeHtml(b.title)}" class="hero-slide-art" onerror="this.src='/static/banners/welcome_banner.jpg'" />
              </div>
            </div>
          </div>
        `;

        wrapper.appendChild(slide);

        // Indicator dot
        if (dotsWrap) {
          const dot = document.createElement("div");
          dot.className = `carousel-dot ${idx === 0 ? "active" : ""}`;
          dot.dataset.index = idx;
          dot.addEventListener("click", () => {
            haptic("light");
            setHeroSlide(idx);
            startHeroAutoSlide();
          });
          dotsWrap.appendChild(dot);
        }
      });

      // Attach play click listeners
      wrapper.querySelectorAll(".btn-hero-play").forEach(btn => {
        btn.addEventListener("click", () => {
          haptic("heavy");
          launchWebGame(btn.dataset.title, btn.dataset.url, btn.dataset.icon);
        });
      });

      if (window.lucide) {
        window.lucide.createIcons();
      }

      setHeroSlide(0);
      startHeroAutoSlide();
    } catch (e) {
      console.warn("Failed to load promo banners:", e);
    }
  }

  // Initial load of sliding window banners
  loadHeroCarouselBanners();

  document.getElementById("btnPlayQuest")?.addEventListener("click", () => {
    haptic("medium");
    launchWebGame("Aviator Rocket", "/static/games/aviator/index.html", "🚀");
  });

  document.getElementById("btnJoinTournament")?.addEventListener("click", () => {
    haptic("heavy");
    launchWebGame("Aviator Rocket", "/static/games/aviator/index.html", "🚀");
  });

  // Hub shortcuts navigation
  document.querySelectorAll(".hub-shortcut-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      haptic("light");
      const nav = btn.dataset.nav;
      if (nav) {
        showView(nav);
      }
    });
  });

  // Category filter scroll bar
  document.querySelectorAll(".cat-filter-btn").forEach(btn => {
    if (btn.id === "btnToggleSearch" || btn.id === "btnNavAddGame") return;
    btn.addEventListener("click", () => {
      haptic("light");
      document.querySelectorAll(".cat-filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.gameFilterCat = btn.dataset.cat || "all";
      renderFilteredGames();
      document.getElementById("sectionAllGames")?.scrollIntoView({ behavior: "smooth" });
    });
  });

  // Search toggle and clear
  const btnToggleSearch = document.getElementById("btnToggleSearch");
  const searchDrawer = document.getElementById("searchDrawer");
  const btnClearSearch = document.getElementById("btnClearSearch");
  btnToggleSearch?.addEventListener("click", () => {
    searchDrawer?.classList.toggle("hidden");
    if (!searchDrawer?.classList.contains("hidden")) {
      document.getElementById("inputGameSearch")?.focus();
    }
  });
  btnClearSearch?.addEventListener("click", () => {
    const sInput = document.getElementById("inputGameSearch");
    if (sInput) {
      sInput.value = "";
      state.gameSearchQuery = "";
      renderFilteredGames();
    }
  });

  // Chunky category cards
  document.querySelectorAll(".chunky-cat-card").forEach(card => {
    card.addEventListener("click", () => {
      haptic("medium");
      const cat = card.dataset.cat;
      state.gameFilterCat = cat;
      document.querySelectorAll(".cat-filter-btn").forEach(b => {
        b.classList.toggle("active", b.dataset.cat === cat);
      });
      renderFilteredGames();
      document.getElementById("sectionAllGames")?.scrollIntoView({ behavior: "smooth" });
    });
  });

  // ============================================================
  // CONFETTI PARTICLE SYSTEM (CELEBRATIONS & PAYMENTS)
  // ============================================================
  function triggerConfetti() {
    const canvas = document.getElementById("confettiCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ["#facc15", "#f59e0b", "#38bdf8", "#ec4899", "#10b981", "#a855f7"];
    const particles = [];
    const count = 75;

    for (let i = 0; i < count; i++) {
      particles.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * 60,
        y: canvas.height * 0.4 + (Math.random() - 0.5) * 40,
        vx: (Math.random() - 0.5) * 14,
        vy: (Math.random() - 0.9) * 16,
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 12,
        alpha: 1,
        gravity: 0.38,
      });
    }

    let startTime = performance.now();
    function renderConfetti(now) {
      const elapsed = now - startTime;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let alive = false;
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.rotation += p.rotSpeed;
        p.alpha -= 0.009;

        if (p.alpha > 0 && p.y < canvas.height + 50) {
          alive = true;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate((p.rotation * Math.PI) / 180);
          ctx.globalAlpha = Math.max(0, p.alpha);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
          ctx.restore();
        }
      });

      if (alive && elapsed < 4000) {
        requestAnimationFrame(renderConfetti);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    requestAnimationFrame(renderConfetti);
  }

  // ============================================================
  // TELEGRAM STARS COIN SHOP & BOT API 8.0 INVOICES
  // ============================================================
  const modalStarsShop = document.getElementById("modalStarsShop");
  const btnCloseStarsShop = document.getElementById("btnCloseStarsShop");
  const coinPill = document.getElementById("coinPill");

  function openStarsShop() {
    haptic("light");
    const storedCoins = localStorage.getItem("flipster_coins") || localStorage.getItem("aviator_coins") || "1000";
    const shopBalEl = document.getElementById("shopUserCoins");
    if (shopBalEl) shopBalEl.textContent = `🪙 ${Number(storedCoins).toLocaleString()} Coins`;
    modalStarsShop?.classList.remove("hidden");
    loadShopConfig();
    if (window.lucide) window.lucide.createIcons();
  }

  function closeStarsShop() {
    modalStarsShop?.classList.add("hidden");
  }

  coinPill?.addEventListener("click", openStarsShop);
  document.getElementById("navShopBtn")?.addEventListener("click", openStarsShop);
  btnCloseStarsShop?.addEventListener("click", closeStarsShop);
  modalStarsShop?.addEventListener("click", (e) => {
    if (e.target === modalStarsShop) closeStarsShop();
  });

  // Handle Stars Purchase Buttons
  document.querySelectorAll(".btn-buy-stars").forEach((btn) => {
    btn.addEventListener("click", async () => {
      haptic("medium");
      const packId = btn.dataset.pack;
      const stars = parseInt(btn.dataset.stars, 10);
      const coins = parseInt(btn.dataset.coins, 10);

      btn.disabled = true;
      const originalText = btn.innerHTML;
      btn.innerHTML = `<span class="star-sym">⏳</span> Invoicing...`;

      try {
        const res = await fetch("/api/stars/create-invoice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pack_id: packId,
            init_data: tg?.initData || "",
            guest_id: state.userId || "guest",
          }),
        });
        const data = await res.json();

        if (data.invoice_link) {
          if (tg && typeof tg.openInvoice === "function" && !data.mock) {
            // Live Telegram Client Native Payment Drawer
            tg.openInvoice(data.invoice_link, (status) => {
              if (status === "paid") {
                triggerConfetti();
                try { tg?.HapticFeedback?.notificationOccurred("success"); } catch (_) {}
                const cur = parseInt(localStorage.getItem("flipster_coins") || "1000", 10);
                const next = cur + coins;
                localStorage.setItem("flipster_coins", next);
                localStorage.setItem("aviator_coins", next);
                document.getElementById("coinVal").textContent = next.toLocaleString();
                document.getElementById("shopUserCoins").textContent = `🪙 ${next.toLocaleString()} Coins`;
                alert(`🎉 Payment Verified!\n\nSuccessfully added +${coins.toLocaleString()} Coins with ${stars} Telegram Stars!`);
                closeStarsShop();
              } else if (status === "cancelled") {
                console.log("Invoice cancelled by user.");
              } else {
                alert("Payment was not completed.");
              }
            });
          } else {
            // Dev / Mock Browser fallback for local testing
            await fetch("/api/stars/dev-credit", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ user_id: state.userId || "guest", coins: coins }),
            });
            triggerConfetti();
            try { tg?.HapticFeedback?.notificationOccurred("success"); } catch (_) {}
            const cur = parseInt(localStorage.getItem("flipster_coins") || "1000", 10);
            const next = cur + coins;
            localStorage.setItem("flipster_coins", next);
            localStorage.setItem("aviator_coins", next);
            document.getElementById("coinVal").textContent = next.toLocaleString();
            document.getElementById("shopUserCoins").textContent = `🪙 ${next.toLocaleString()} Coins`;
            alert(`🎉 [Mock Test Mode]\n\nSuccessfully credited +${coins.toLocaleString()} Coins (${stars} Stars) for testing!`);
            closeStarsShop();
          }
        } else {
          alert(`Could not generate Stars invoice: ${data.detail || "Server error"}`);
        }
      } catch (err) {
        console.error("Payment error:", err);
        alert("Payment connection error. Please try again.");
      } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    });
  });

  // Store Tab Switching (Stars, UPI, Crypto)
  document.querySelectorAll(".store-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      haptic("light");
      document.querySelectorAll(".store-tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.dataset.tab;
      document.getElementById("tabContentStars")?.classList.toggle("active", target === "stars");
      document.getElementById("tabContentUpi")?.classList.toggle("active", target === "upi");
      document.getElementById("tabContentCrypto")?.classList.toggle("active", target === "crypto");
    });
  });

  // State for UPI deposit
  let shopConfig = { upi_id: "patelkeshav@upi", upi_name: "Ghost Plays Arena" };
  let selectedUpiPack = { id: "pack_inr_99", inr: 99, coins: 18000 };

  async function loadShopConfig() {
    try {
      const res = await fetch("/api/shop/config");
      const data = await res.json();
      shopConfig = data;
      const upiDisplay = document.getElementById("displayUpiId");
      if (upiDisplay) upiDisplay.textContent = shopConfig.upi_id;
      if (data.channel_url && data.channel_url !== "https://t.me/ghost_help_and_support_bot") {
        const chBtn = document.getElementById("btnOfficialChannelLink");
        if (chBtn) {
          chBtn.href = data.channel_url;
          chBtn.textContent = "JOIN";
        }
      }
      updateUpiDisplay();
    } catch (_) {}
  }

  function updateUpiDisplay() {
    const upiId = shopConfig.upi_id || "patelkeshav@upi";
    const amount = selectedUpiPack.inr;
    const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(shopConfig.upi_name || "GhostPlays")}&am=${amount}&cu=INR`;
    
    const qrImg = document.getElementById("upiQrImage");
    if (qrImg) {
      qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(upiUrl)}`;
    }
    const amtBadge = document.getElementById("upiAmountBadge");
    if (amtBadge) amtBadge.textContent = `PAY ₹${amount}`;
    const intentBtn = document.getElementById("btnPayUpiIntent");
    if (intentBtn) intentBtn.href = upiUrl;
  }

  // Handle UPI Pack Selection
  document.querySelectorAll(".upi-pack-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      haptic("light");
      document.querySelectorAll(".upi-pack-pill").forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      selectedUpiPack = {
        id: pill.dataset.pack,
        inr: parseInt(pill.dataset.inr, 10),
        coins: parseInt(pill.dataset.coins, 10),
      };
      updateUpiDisplay();
    });
  });

  // Copy UPI ID
  document.getElementById("btnCopyUpiId")?.addEventListener("click", () => {
    haptic("light");
    const upiId = shopConfig.upi_id || "patelkeshav@upi";
    navigator.clipboard?.writeText(upiId).then(() => {
      alert(`📋 Copied UPI ID: ${upiId}`);
    });
  });

  // Submit UTR Reference
  document.getElementById("formSubmitUtr")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const utrInput = document.getElementById("inputUtrRef");
    const utr = utrInput.value.trim();
    if (utr.length < 6) {
      alert("Please enter a valid 12-digit UPI Reference / UTR Number from your payment receipt.");
      return;
    }
    const btn = document.getElementById("btnSubmitUtr");
    btn.disabled = true;
    btn.textContent = "Verifying...";

    try {
      const res = await fetch("/api/shop/submit-upi-deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pack_id: selectedUpiPack.id,
          utr_ref: utr,
          init_data: tg?.initData || "",
          guest_id: state.userId || "guest",
          guest_name: state.userName || "Player",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        haptic("heavy");
        alert(
          `✅ Deposit Request Submitted!\n\n` +
          `Pack: ₹${selectedUpiPack.inr} (+${selectedUpiPack.coins.toLocaleString()} Coins)\n` +
          `UTR Ref: ${utr}\n\n` +
          `The admin has been notified and will verify your transaction to credit coins within 2-5 minutes!`
        );
        utrInput.value = "";
        closeStarsShop();
      } else {
        alert(`Error: ${data.detail || "Could not submit deposit."}`);
      }
    } catch (err) {
      alert("Connection error while submitting UTR.");
    } finally {
      btn.disabled = false;
      btn.textContent = "Verify";
    }
  });

  // Listen for iframe child game messages (e.g. from Aviator, Fruit Slice, Knife Hit)
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data) return;

    // Close & Pause forwarded from in-game buttons
    if (
      data.type === "closeGame" ||
      data.type === "close" ||
      data.type === "exitGame" ||
      data.type === "back" ||
      data.action === "close" ||
      data.action === "exit"
    ) {
      exitGameToHome();
      return;
    }

    if (
      data.type === "pauseGame" ||
      data.type === "pause" ||
      data.action === "pause"
    ) {
      openPlayerPauseOverlay();
      return;
    }

    if (data.type === "OPEN_STARS_SHOP") {
      openStarsShop();
    }

    // Game over sound and heavy haptic feedback
    if (
      data.type === "fruit_slice_game_over" ||
      data.type === "knife_hit_game_over" ||
      data.type === "game_over"
    ) {
      haptic("heavy");
      playGameOverDefeatSound();
    }

    // Multiplayer Arena live score bridging
    if (data.type === "arena_live_score" && state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({
        type: "score_update",
        score: data.score,
        level: data.level || data.stage || 1,
        lives: data.lives,
        status: data.status,
      }));
    }
  });

  // ============================================================
  // BOT API 8.0: ADD TO HOME SCREEN FEATURE
  // ============================================================
  const btnAddToHomeScreen = document.getElementById("btnAddToHomeScreen");
  const homeScreenStatusMsg = document.getElementById("homeScreenStatusMsg");

  if (btnAddToHomeScreen) {
    // Check home screen support if available in Bot API 8.0+
    try {
      if (tg && typeof tg.checkHomeScreenStatus === "function") {
        tg.checkHomeScreenStatus((status) => {
          if (status === "added") {
            btnAddToHomeScreen.innerHTML = `<i data-lucide="check-circle" class="lucide-sm"></i> Installed on Home Screen`;
            btnAddToHomeScreen.disabled = true;
            if (homeScreenStatusMsg) homeScreenStatusMsg.textContent = "✅ Ghost Plays is installed on your device!";
          }
        });
      }
    } catch (_) {}

    btnAddToHomeScreen.addEventListener("click", () => {
      haptic("heavy");
      try {
        if (tg && typeof tg.addToHomeScreen === "function") {
          tg.addToHomeScreen();
        } else {
          alert(
            "📲 Install Ghost Plays on Phone:\n\n" +
            "1. In the Telegram app, open this Mini App.\n" +
            "2. Tap the ⋮ (three dots) menu in the top right.\n" +
            "3. Select 'Add to Home Screen'!"
          );
        }
      } catch (_) {
        alert("Tip: Open Mini App menu (⋮) in Telegram and tap 'Add to Home Screen'.");
      }
    });
  }

  // Direct promo launcher map for one-click Gamee-style play buttons
  const PROMO_LAUNCH_MAP = {
    aviator: { title: "Aviator Rocket", url: "/static/games/aviator/index.html", icon: "🚀" },
    flipster: { title: "Aviator Rocket", url: "/static/games/aviator/index.html", icon: "🚀" },
    dino: { title: "Cyber Dino", url: "/static/games/dino/index.html", icon: "🦖" },
    tetris: { title: "Retro Tetris", url: "/static/games/tetris/index.html", icon: "🧩" },
    space_invaders: { title: "Galaxy Defender", url: "/static/games/space_invaders/index.html", icon: "👾" },
    knife_hit: { title: "Knife Master 3D", url: "/static/games/knife_hit/index.html", icon: "🗡️" },
    knife: { title: "Knife Master 3D", url: "/static/games/knife_hit/index.html", icon: "🗡️" },
    tictactoe: { title: "XO Blitz", url: "/static/games/tictactoe/index.html", icon: "❌" },
    xo: { title: "XO Blitz", url: "/static/games/tictactoe/index.html", icon: "❌" },
    "2048": { title: "2048 Neon", url: "/static/games/2048/index.html", icon: "🔢" },
    space_race: { title: "Space Race", url: "/static/games/space_race/index.html", icon: "🚀" },
    breakout: { title: "Neon Breakout", url: "/static/games/breakout/index.html", icon: "🧱" },
    snake: { title: "Retro Snake", url: "/static/games/snake/index.html", icon: "🐍" },
    helix_jump: { title: "Helix Spiral", url: "/static/games/helix_jump/index.html", icon: "🌀" },
    fruit_slice: { title: "Fruit Ninja", url: "/static/games/fruit_slice/index.html", icon: "🍉" },
    tower_stack: { title: "Tower Stack", url: "/static/games/tower_stack/index.html", icon: "🏗️" },
    roll_ball: { title: "Roll the Ball", url: "/static/games/roll_ball/index.html", icon: "🪵" },
    uno: { title: "UNO Classic Arena", url: "/static/games/uno/index.html", icon: "🃏" },
    speed_typer: { title: "Speed Typer", url: "/static/games/speed_typer/index.html", icon: "⌨️" },
    wordle: { title: "Wordle Guess", url: "/static/games/wordle/index.html", icon: "🔤" },
  };

  // Check URL query parameters and Telegram Mini App start_param for auto-nav
  const urlParams = new URLSearchParams(window.location.search);
  const tgStartParam = urlParams.get("tgWebAppStartParam") || 
                       window.Telegram?.WebApp?.initDataUnsafe?.start_param || 
                       urlParams.get("startapp") || 
                       "";

  let targetGame = urlParams.get("game") || "";
  if (!targetGame && tgStartParam.startsWith("game_")) {
    targetGame = tgStartParam.replace("game_", "");
  }

  if (urlParams.get("tab") === "shop" || tgStartParam === "shop") {
    setTimeout(openStarsShop, 300);
  } else if (targetGame && PROMO_LAUNCH_MAP[targetGame.toLowerCase()]) {
    const g = PROMO_LAUNCH_MAP[targetGame.toLowerCase()];
    setTimeout(() => {
      launchWebGame(g.title, g.url, g.icon);
    }, 400);
  }

  async function loadAdminGamesList() {
    const listEl = document.getElementById("adminGamesList");
    const res = await fetch("/api/custom-games");
    const data = await res.json();
    if (!data.games.length) {
      listEl.innerHTML = `<div style="font-size: 0.8rem; color: var(--muted);">No games added yet.</div>`;
      return;
    }
    const secret = document.getElementById("inputAdminSecret").value || "";
    listEl.innerHTML = data.games
      .map(
        (g) => {
          const logoEl = g.image_url
            ? `<img src="${g.image_url}" style="width:26px;height:26px;border-radius:6px;object-fit:cover;vertical-align:middle;margin-right:6px;" alt="">`
            : `<span style="font-size:1.1rem;margin-right:6px;">${g.icon || "🎮"}</span>`;
          return `
      <div class="admin-game-row" style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
        <span style="display:flex;align-items:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;">${logoEl} <strong>${g.title}</strong></span>
        <div style="display:flex;gap:6px;">
          <button class="btn small primary" data-edit="${g.id}" title="Edit Game & Logo">✏️</button>
          <button class="btn small danger" data-del="${g.id}" title="Delete Game">🗑️</button>
        </div>
      </div>`;
        }
      )
      .join("");

    listEl.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.edit;
        const g = (data.games || []).find((item) => String(item.id) === String(id));
        if (!g) return;
        state.editingGameId = g.id;

        document.getElementById("inputGameTitle").value = g.title || "";
        document.getElementById("inputGameUrl").value = g.url || "";
        document.getElementById("inputGameIcon").value = g.icon || "🎮";
        document.getElementById("inputGameDesc").value = g.description || "";
        if (inputGameLogoUrl) inputGameLogoUrl.value = g.image_url || "";
        originalRawLogoSrc = g.image_url || "";
        setLogoFocal(50, 50, 100);
        updateLogoPreview(g.image_url || "");

        const modalTitle = document.getElementById("adminModalTitle");
        if (modalTitle) modalTitle.textContent = `✏️ Edit: ${g.title}`;
        const submitBtn = document.getElementById("btnSubmitAddGame");
        if (submitBtn) submitBtn.textContent = "💾 Update Game Logo & Details";
        document.getElementById("btnCancelEditGame")?.classList.remove("hidden");

        document.querySelector("#modalAddGame .modal-card")?.scrollTo({ top: 0, behavior: "smooth" });
      });
    });

    listEl.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.del;
        const delRes = await fetch(
          `/api/admin/games/${id}?user_id=${encodeURIComponent(state.userId)}&admin_secret=${encodeURIComponent(secret)}`,
          { method: "DELETE" }
        );
        if (delRes.ok) {
          loadAdminGamesList();
          loadCustomGames();
        } else {
          alert("Could not delete game (check admin permissions).");
        }
      });
    });
  }

  function resetAdminGameForm() {
    state.editingGameId = null;
    document.getElementById("inputGameTitle").value = "";
    document.getElementById("inputGameUrl").value = "";
    document.getElementById("inputGameDesc").value = "";
    if (inputGameLogoUrl) inputGameLogoUrl.value = "";
    if (inputGameLogoFile) inputGameLogoFile.value = "";
    originalRawLogoSrc = "";
    setLogoFocal(50, 50, 100);
    updateLogoPreview("");
    const modalTitle = document.getElementById("adminModalTitle");
    if (modalTitle) modalTitle.textContent = "⚙️ Manage Web Games";
    const submitBtn = document.getElementById("btnSubmitAddGame");
    if (submitBtn) submitBtn.textContent = "🚀 Add Game to Mini App";
    document.getElementById("btnCancelEditGame")?.classList.add("hidden");
  }

  document.getElementById("btnCancelEditGame")?.addEventListener("click", resetAdminGameForm);

  document.getElementById("btnCloseGamePlayer")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    exitGameToHome();
  });

  const btnOpenAddGameModal = document.getElementById("btnOpenAddGameModal");
  const btnNavAddGame = document.getElementById("btnNavAddGame");
  const btnShortcutAddGame = document.getElementById("btnShortcutAddGame");

  function openAddGameStudio() {
    if (!state.isAdmin) {
      if (typeof showToast === "function") showToast("Admin access required to open Game Studio");
      else alert("Admin access required to open Game Studio");
      return;
    }
    showView("addGame");
    loadAdminGamesList();
    loadAdminBannersList();
    populateBannerGameSelect();
  }

  btnOpenAddGameModal?.addEventListener("click", openAddGameStudio);
  btnNavAddGame?.addEventListener("click", openAddGameStudio);
  btnShortcutAddGame?.addEventListener("click", openAddGameStudio);

  document.getElementById("btnBackFromStudio")?.addEventListener("click", () => {
    showView(state.prevView || "home");
  });

  // Studio tabs switching (Add/Manage Games vs Sliding Window Banners)
  const tabBtnAddGame = document.getElementById("tabBtnAddGame");
  const tabBtnPromoBanners = document.getElementById("tabBtnPromoBanners");
  const tabContentAddGame = document.getElementById("tabContentAddGame");
  const tabContentPromoBanners = document.getElementById("tabContentPromoBanners");

  tabBtnAddGame?.addEventListener("click", () => {
    tabBtnAddGame.classList.add("active");
    tabBtnPromoBanners?.classList.remove("active");
    tabContentAddGame?.classList.remove("hidden");
    tabContentPromoBanners?.classList.add("hidden");
  });

  tabBtnPromoBanners?.addEventListener("click", () => {
    tabBtnPromoBanners.classList.add("active");
    tabBtnAddGame?.classList.remove("active");
    tabContentPromoBanners?.classList.remove("hidden");
    tabContentAddGame?.classList.add("hidden");
    loadAdminBannersList();
    populateBannerGameSelect();
  });

  const inputGameLogoFile = document.getElementById("inputGameLogoFile");
  const inputGameLogoUrl = document.getElementById("inputGameLogoUrl");
  const previewLogoImg = document.getElementById("previewLogoImg");
  const previewEmoji = document.getElementById("previewEmoji");

  let logoFocal = { x: 50, y: 50, zoom: 100 };
  let originalRawLogoSrc = "";

  const sliderFocalX = document.getElementById("sliderFocalX");
  const sliderFocalY = document.getElementById("sliderFocalY");
  const sliderFocalZoom = document.getElementById("sliderFocalZoom");
  const valFocalX = document.getElementById("valFocalX");
  const valFocalY = document.getElementById("valFocalY");
  const valFocalZoom = document.getElementById("valFocalZoom");
  const lblFocalValue = document.getElementById("lblFocalValue");

  function setLogoFocal(x, y, zoom) {
    logoFocal.x = Math.max(0, Math.min(100, x));
    logoFocal.y = Math.max(0, Math.min(100, y));
    if (zoom !== undefined && zoom !== null) {
      logoFocal.zoom = Math.max(100, Math.min(250, parseInt(zoom, 10) || 100));
    }

    if (sliderFocalX) sliderFocalX.value = logoFocal.x;
    if (sliderFocalY) sliderFocalY.value = logoFocal.y;
    if (sliderFocalZoom) sliderFocalZoom.value = logoFocal.zoom;

    if (valFocalX) valFocalX.textContent = `${logoFocal.x}%`;
    if (valFocalY) valFocalY.textContent = `${logoFocal.y}%`;
    if (valFocalZoom) valFocalZoom.textContent = `${(logoFocal.zoom / 100).toFixed(1)}x`;
    if (lblFocalValue) lblFocalValue.textContent = `${logoFocal.x}% ${logoFocal.y}% (${(logoFocal.zoom / 100).toFixed(1)}x)`;

    if (previewLogoImg) {
      previewLogoImg.style.objectPosition = `${logoFocal.x}% ${logoFocal.y}%`;
      previewLogoImg.style.transform = logoFocal.zoom > 100 ? `scale(${logoFocal.zoom / 100})` : "none";
      previewLogoImg.style.transformOrigin = `${logoFocal.x}% ${logoFocal.y}%`;
    }
    document.querySelectorAll(".btn-lfc").forEach((btn) => {
      const bx = parseInt(btn.dataset.fx, 10);
      const by = parseInt(btn.dataset.fy, 10);
      btn.classList.toggle("active", bx === logoFocal.x && by === logoFocal.y);
    });
  }

  document.querySelectorAll(".btn-lfc").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fx = parseInt(btn.dataset.fx, 10) || 50;
      const fy = parseInt(btn.dataset.fy, 10) || 50;
      setLogoFocal(fx, fy, logoFocal.zoom);
    });
  });

  sliderFocalX?.addEventListener("input", (e) => {
    setLogoFocal(parseInt(e.target.value, 10), logoFocal.y, logoFocal.zoom);
  });
  sliderFocalY?.addEventListener("input", (e) => {
    setLogoFocal(logoFocal.x, parseInt(e.target.value, 10), logoFocal.zoom);
  });
  sliderFocalZoom?.addEventListener("input", (e) => {
    setLogoFocal(logoFocal.x, logoFocal.y, parseInt(e.target.value, 10));
  });

  function cropImageWithFocal(imgSrc, fx, fy, zoomVal = 100) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          const targetSize = 512;
          canvas.width = targetSize;
          canvas.height = targetSize;
          const ctx = canvas.getContext("2d");

          const srcW = img.naturalWidth || img.width;
          const srcH = img.naturalHeight || img.height;
          const baseSide = Math.min(srcW, srcH);
          const zoomFactor = Math.max(1, (zoomVal || 100) / 100);
          const side = Math.max(20, baseSide / zoomFactor);

          const maxCropX = Math.max(0, srcW - side);
          const maxCropY = Math.max(0, srcH - side);
          const cropX = Math.min(maxCropX, Math.max(0, (maxCropX * fx) / 100));
          const cropY = Math.min(maxCropY, Math.max(0, (maxCropY * fy) / 100));

          ctx.drawImage(img, cropX, cropY, side, side, 0, 0, targetSize, targetSize);
          resolve(canvas.toDataURL("image/png"));
        } catch (e) {
          console.warn("Canvas crop fallback:", e);
          resolve(imgSrc);
        }
      };
      img.onerror = () => resolve(imgSrc);
      img.src = imgSrc;
    });
  }

  function updateLogoPreview(src) {
    if (src) {
      if (previewLogoImg) {
        previewLogoImg.src = src;
        previewLogoImg.style.objectPosition = `${logoFocal.x}% ${logoFocal.y}%`;
        previewLogoImg.classList.remove("hidden");
      }
      if (previewEmoji) previewEmoji.classList.add("hidden");
    } else {
      if (previewLogoImg) {
        previewLogoImg.src = "";
        previewLogoImg.classList.add("hidden");
      }
      if (previewEmoji) previewEmoji.classList.remove("hidden");
    }
  }

  inputGameLogoUrl?.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    originalRawLogoSrc = val;
    updateLogoPreview(val);
  });

  inputGameLogoFile?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const base64Data = evt.target.result;
      originalRawLogoSrc = base64Data;
      updateLogoPreview(base64Data);

      const admin_secret = document.getElementById("inputAdminSecret")?.value.trim() || "";
      try {
        const res = await fetch("/api/admin/upload-logo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_base64: base64Data,
            filename: file.name,
            user_id: state.userId || "",
            admin_secret: admin_secret,
          }),
        });
        if (res.ok) {
          const d = await res.json();
          if (d.image_url) {
            const fullUrl = d.image_url.startsWith("http") ? d.image_url : (window.location.origin + d.image_url);
            if (inputGameLogoUrl) inputGameLogoUrl.value = fullUrl;
          }
        }
      } catch (err) {
        console.warn("Logo auto-upload preview retained:", err);
      }
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("formAddGame")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("inputGameTitle").value.trim();
    const url = document.getElementById("inputGameUrl").value.trim();
    const icon = document.getElementById("inputGameIcon").value.trim() || "🎮";
    const logoUrl = document.getElementById("inputGameLogoUrl")?.value.trim() || "";
    const description = document.getElementById("inputGameDesc").value.trim();
    const admin_secret = document.getElementById("inputAdminSecret").value.trim();

    let finalImageUrl = logoUrl;
    const sourceImage = originalRawLogoSrc || (previewLogoImg && previewLogoImg.src ? previewLogoImg.src : "");
    if (sourceImage && (sourceImage.startsWith("data:") || sourceImage.startsWith("blob:") || !finalImageUrl)) {
      try {
        const croppedBase64 = await cropImageWithFocal(sourceImage, logoFocal.x, logoFocal.y, logoFocal.zoom);
        const upRes = await fetch("/api/admin/upload-logo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_base64: croppedBase64,
            filename: "custom_logo.png",
            user_id: state.userId || "",
            admin_secret: admin_secret,
          }),
        });
        if (upRes.ok) {
          const upData = await upRes.json();
          finalImageUrl = upData.image_url || finalImageUrl;
        }
      } catch (err) {
        console.error("Failed to crop/upload logo on submit:", err);
      }
    }

    const isEdit = Boolean(state.editingGameId);
    const endpoint = isEdit ? `/api/admin/games/${state.editingGameId}` : "/api/admin/games";
    const method = isEdit ? "PUT" : "POST";

    const res = await fetch(endpoint, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        url,
        icon,
        image_url: finalImageUrl,
        description,
        user_id: state.userId,
        admin_secret,
      }),
    });
    if (res.ok) {
      if (finalImageUrl) {
        try {
          localStorage.setItem("game_logo_" + url, finalImageUrl);
          localStorage.setItem("game_logo_" + title, finalImageUrl);
        } catch (_) {}
      }
      resetAdminGameForm();
      loadAdminGamesList();
      loadCustomGames();
      loadHeroCarouselBanners(); // Live update home carousel with updated game logo
      populateBannerGameSelect();
      alert(isEdit ? "✅ Game logo & details successfully updated!" : "✅ Game successfully added to Mini App!");
    } else {
      const err = await res.json();
      alert(`Error: ${err.detail || "Could not save game."}`);
    }
  });

  // --- Sliding Window Banner Studio (Admin) ---
  function populateBannerGameSelect() {
    const sel = document.getElementById("bannerSelectGame");
    if (!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">-- Choose from Arcade Catalog (Auto-fills) --</option>';

    // Collect all games from state.arcadeGames and customGames
    const allGames = [...DEFAULT_ARCADE_GAMES, ...(state.customGames || [])];
    const seen = new Set();
    allGames.forEach((g) => {
      const u = (g.url || "").trim();
      if (!u || seen.has(u)) return;
      seen.add(u);
      const opt = document.createElement("option");
      opt.value = u;
      opt.textContent = `${g.icon || "🎮"} ${g.title}`;
      opt.dataset.title = g.title;
      opt.dataset.icon = g.icon || "🎮";
      opt.dataset.image = g.image_url || "";
      opt.dataset.desc = g.description || "";
      sel.appendChild(opt);
    });
    if (currentVal) sel.value = currentVal;
  }

  document.getElementById("bannerSelectGame")?.addEventListener("change", (e) => {
    const sel = e.target;
    const opt = sel.options[sel.selectedIndex];
    if (!opt || !opt.value) return;

    const bTitle = document.getElementById("bannerTitle");
    if (bTitle) bTitle.value = (opt.dataset.title || "").toUpperCase();

    const gUrl = document.getElementById("bannerGameUrl");
    if (gUrl) gUrl.value = opt.value;

    const gTitle = document.getElementById("bannerGameTitle");
    if (gTitle) gTitle.value = opt.dataset.title || "";

    const bDesc = document.getElementById("bannerDesc");
    if (bDesc && opt.dataset.desc) bDesc.value = opt.dataset.desc;

    const imgUrl = opt.dataset.image;
    if (imgUrl) {
      const inputImg = document.getElementById("inputBannerImageUrl");
      if (inputImg) inputImg.value = imgUrl;
      const preview = document.getElementById("bannerImgPreview");
      if (preview) preview.src = imgUrl;
    }
  });

  const inputBannerFile = document.getElementById("inputBannerFile");
  const inputBannerImageUrl = document.getElementById("inputBannerImageUrl");
  const bannerImgPreview = document.getElementById("bannerImgPreview");

  inputBannerFile?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const b64 = ev.target.result;
      if (inputBannerImageUrl) inputBannerImageUrl.value = b64;
      if (bannerImgPreview) bannerImgPreview.src = b64;
    };
    reader.readAsDataURL(file);
  });

  inputBannerImageUrl?.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    if (bannerImgPreview) {
      bannerImgPreview.src = val || "/static/banners/welcome_banner.jpg";
    }
  });

  function resetBannerForm() {
    const editId = document.getElementById("editBannerId");
    if (editId) editId.value = "";
    const bTitle = document.getElementById("bannerTitle");
    if (bTitle) bTitle.value = "";
    const bBadge = document.getElementById("bannerBadge");
    if (bBadge) bBadge.value = "";
    const bBadge2 = document.getElementById("bannerBadge2");
    if (bBadge2) bBadge2.value = "";
    const bDesc = document.getElementById("bannerDesc");
    if (bDesc) bDesc.value = "";
    if (inputBannerImageUrl) inputBannerImageUrl.value = "";
    const bGUrl = document.getElementById("bannerGameUrl");
    if (bGUrl) bGUrl.value = "";
    const bGTitle = document.getElementById("bannerGameTitle");
    if (bGTitle) bGTitle.value = "";
    const bTheme = document.getElementById("bannerTheme");
    if (bTheme) bTheme.value = "slide-aviator";
    if (inputBannerFile) inputBannerFile.value = "";
    if (bannerImgPreview) bannerImgPreview.src = "/static/banners/welcome_banner.jpg";
    const bannerSelectGame = document.getElementById("bannerSelectGame");
    if (bannerSelectGame) bannerSelectGame.value = "";
    const titleEl = document.getElementById("bannerFormTitle");
    if (titleEl) titleEl.textContent = "✨ Customize Sliding Window Banner";
    const submitBtn = document.getElementById("btnSubmitBanner");
    if (submitBtn) submitBtn.textContent = "💾 Save Sliding Window Banner";
    document.getElementById("btnCancelEditBanner")?.classList.add("hidden");
  }

  function editBanner(b) {
    const editId = document.getElementById("editBannerId");
    if (editId) editId.value = b.id;
    const bTitle = document.getElementById("bannerTitle");
    if (bTitle) bTitle.value = b.title || "";
    const bBadge = document.getElementById("bannerBadge");
    if (bBadge) bBadge.value = b.badge || "";
    const bBadge2 = document.getElementById("bannerBadge2");
    if (bBadge2) bBadge2.value = b.badge2 || "";
    const bDesc = document.getElementById("bannerDesc");
    if (bDesc) bDesc.value = b.description || "";
    if (inputBannerImageUrl) inputBannerImageUrl.value = b.image_url || "";
    const bGUrl = document.getElementById("bannerGameUrl");
    if (bGUrl) bGUrl.value = b.game_url || "";
    const bGTitle = document.getElementById("bannerGameTitle");
    if (bGTitle) bGTitle.value = b.game_title || "";
    const bTheme = document.getElementById("bannerTheme");
    if (bTheme) bTheme.value = b.bg_theme || "slide-aviator";
    if (bannerImgPreview) {
      bannerImgPreview.src = b.image_url || b.game_current_image || "/static/banners/welcome_banner.jpg";
    }

    const titleEl = document.getElementById("bannerFormTitle");
    if (titleEl) titleEl.textContent = `✏️ Edit Banner: ${b.title}`;
    const submitBtn = document.getElementById("btnSubmitBanner");
    if (submitBtn) submitBtn.textContent = "💾 Update Sliding Banner";
    document.getElementById("btnCancelEditBanner")?.classList.remove("hidden");

    // Scroll smoothly to banner form
    document.getElementById("tabContentPromoBanners")?.scrollIntoView({ behavior: "smooth" });
  }

  async function deleteBanner(id) {
    if (!confirm("Are you sure you want to remove this slide from the home carousel?")) return;
    const secret = document.getElementById("inputAdminSecret")?.value.trim() || "";
    try {
      const res = await fetch(`/api/admin/promo-banners/${id}?user_id=${encodeURIComponent(state.userId)}&admin_secret=${encodeURIComponent(secret)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        loadAdminBannersList();
        loadHeroCarouselBanners();
        if (typeof showToast === "function") showToast("Banner deleted from sliding window");
      } else {
        alert("Failed to delete banner. Check admin permissions.");
      }
    } catch (e) {
      alert("Error deleting banner: " + e.message);
    }
  }

  document.getElementById("btnNewBanner")?.addEventListener("click", resetBannerForm);
  document.getElementById("btnCancelEditBanner")?.addEventListener("click", resetBannerForm);

  async function loadAdminBannersList() {
    const listEl = document.getElementById("adminBannersList");
    if (!listEl) return;
    listEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:12px;">Loading sliding banners...</div>';

    const secret = document.getElementById("inputAdminSecret")?.value.trim() || "";
    try {
      const res = await fetch(`/api/admin/promo-banners?user_id=${encodeURIComponent(state.userId)}&admin_secret=${encodeURIComponent(secret)}`);
      if (!res.ok) {
        listEl.innerHTML = '<div style="color:#ef4444;font-size:0.85rem;padding:12px;">Failed to load banners (Admin access required)</div>';
        return;
      }
      const data = await res.json();
      const banners = data.banners || [];
      if (!banners.length) {
        listEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:12px;">No sliding banners created yet.</div>';
        return;
      }

      listEl.innerHTML = "";
      banners.forEach((b) => {
        const row = document.createElement("div");
        row.className = "admin-banner-card";
        const art = b.image_url || b.game_current_image || "/static/banners/welcome_banner.jpg";
        row.innerHTML = `
          <img src="${art}" class="admin-banner-art" alt="${escapeHtml(b.title)}" onerror="this.src='/static/banners/welcome_banner.jpg'" />
          <div class="admin-banner-info">
            <div class="admin-banner-title">${escapeHtml(b.title)}</div>
            <div class="admin-banner-meta">
              <span>${b.badge ? escapeHtml(b.badge) : "Banner"}</span> • <span>${escapeHtml(b.game_title || b.game_url)}</span>
            </div>
          </div>
          <div class="admin-banner-actions">
            <button type="button" class="btn small edit-banner-btn" style="padding:4px 8px;">✏️</button>
            <button type="button" class="btn small danger delete-banner-btn" style="padding:4px 8px;">🗑️</button>
          </div>
        `;

        row.querySelector(".edit-banner-btn")?.addEventListener("click", () => editBanner(b));
        row.querySelector(".delete-banner-btn")?.addEventListener("click", () => deleteBanner(b.id));

        listEl.appendChild(row);
      });
    } catch (e) {
      listEl.innerHTML = `<div style="color:#ef4444;font-size:0.85rem;padding:12px;">Error: ${e.message}</div>`;
    }
  }

  document.getElementById("formPromoBanner")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const bannerId = document.getElementById("editBannerId").value;
    const isEdit = Boolean(bannerId);
    const title = document.getElementById("bannerTitle").value.trim();
    const bg_theme = document.getElementById("bannerTheme").value;
    const badge = document.getElementById("bannerBadge").value.trim();
    const badge2 = document.getElementById("bannerBadge2").value.trim();
    const description = document.getElementById("bannerDesc").value.trim();
    let image_url = document.getElementById("inputBannerImageUrl").value.trim();
    const game_url = document.getElementById("bannerGameUrl").value.trim();
    const game_title = document.getElementById("bannerGameTitle").value.trim();
    const admin_secret = document.getElementById("inputAdminSecret")?.value.trim() || "";

    // Upload base64 image if present
    if (image_url.startsWith("data:image/")) {
      try {
        const upRes = await fetch("/api/admin/upload-logo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_base64: image_url,
            filename: `banner_${Date.now()}.png`,
            user_id: state.userId,
            admin_secret: admin_secret,
          }),
        });
        if (upRes.ok) {
          const upData = await upRes.json();
          image_url = upData.image_url;
        }
      } catch (_) {}
    }

    const payload = {
      title,
      badge,
      badge2,
      description,
      image_url,
      game_url,
      game_title,
      bg_theme,
      user_id: state.userId,
      admin_secret,
    };

    const endpoint = isEdit ? `/api/admin/promo-banners/${bannerId}` : "/api/admin/promo-banners";
    const method = isEdit ? "PUT" : "POST";

    try {
      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || "Failed to save banner");
        return;
      }

      resetBannerForm();
      loadAdminBannersList();
      loadHeroCarouselBanners();
      alert(isEdit ? "✅ Sliding banner updated successfully!" : "✅ New promo banner added to home slider!");
    } catch (err) {
      alert("Error saving banner: " + err.message);
    }
  });

  loadCustomGames();
  initAuth();

  if (window.lucide) {
    window.lucide.createIcons();
  }
})();
