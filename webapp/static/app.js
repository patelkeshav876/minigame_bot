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
    player: document.getElementById("view-player"),
  };

  function showView(name) {
    Object.entries(views).forEach(([k, el]) => el.classList.toggle("active", k === name));
    navItems.forEach((n) => n.classList.toggle("active", n.dataset.view === name));
    document.getElementById("bottomNav").classList.toggle("hidden", name === "match" || name === "player");
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
    const total = profile.wins + profile.losses + profile.draws;
    const wr = total ? Math.round((profile.wins / total) * 100) : 0;

    profilePill.textContent = `${profile.tier?.icon || "🥉"} ${elo} ELO`;
    document.getElementById("homeTierIcon").textContent = profile.tier?.icon || "🥉";
    document.getElementById("homePlayerName").textContent = profile.display_name;
    document.getElementById("homeTierName").textContent = profile.tier?.name || "Bronze";
    document.getElementById("homeGlobalElo").textContent = `${elo} ELO`;
    document.getElementById("homeWinRate").textContent = `${wr}% WR`;
    document.getElementById("homeLevelPill").textContent = `LVL ${profile.level || 1}`;

    const pct = Math.min(100, Math.round(((profile.xp_progress || 0) / (profile.xp_next || 100)) * 100));
    document.getElementById("homeXpFill").style.width = `${pct}%`;
    document.getElementById("homeXpLabel").textContent = `${profile.xp_progress || 0} / ${profile.xp_next || 100} XP`;

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
    const gr = data.profile.game_ratings || {};
    ratingsEl.innerHTML = games
      .map((g) => {
        const item = gr[g] || { elo: 1200, wins: 0, losses: 0, draws: 0, tier: { icon: "🥉", name: "Bronze" } };
        return `
          <div class="rating-tile">
            <div class="rt-game">${g.replaceAll("_", " ")}</div>
            <div class="rt-elo">${item.tier?.icon || "🥉"} ${Math.round(item.elo)}</div>
            <div class="rt-rec">${item.wins}W / ${item.losses}L / ${item.draws}D</div>
          </div>`;
      })
      .join("");

    const histEl = document.getElementById("matchHistoryList");
    if (!data.history.length) {
      histEl.textContent = "No ranked PvP matches played yet.";
      return;
    }
    histEl.innerHTML = data.history
      .map((m) => {
        const isP1 = m.player1_id === state.userId;
        const opp = isP1 ? m.player2_name : m.player1_name;
        const delta = isP1 ? m.p1_elo_delta : m.p2_elo_delta;
        const resTag = !m.winner_id ? "🤝 Draw" : m.winner_id === state.userId ? "🏆 Win" : "❌ Loss";
        const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;
        return `
          <div class="history-row">
            <span><strong>${resTag}</strong> vs ${opp} (${m.game_type})</span>
            <span>${deltaStr} ELO</span>
          </div>`;
      })
      .join("");
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

    if (state.isAdmin) {
      document.getElementById("btnOpenAddGameModal").classList.remove("hidden");
    }

    renderProfileSummary(data.profile);
    refreshLiveRooms();
    loadCustomGames();

    const startParam = tg?.initDataUnsafe?.start_param || "";
    const urlRoom = new URLSearchParams(window.location.search).get("room");
    if (startParam.startsWith("room_")) joinRoom(startParam.replace("room_", ""));
    else if (urlRoom) joinRoom(urlRoom);
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

  function updatePlayerCards() {
    const room = state.room;
    if (!room) return;
    const selfP = room.players.find((p) => p.user_id === state.userId) || room.players[0];
    const oppP = room.players.find((p) => p.user_id !== selfP?.user_id);

    const selfCard = document.getElementById("selfCard");
    const oppCard = document.getElementById("opponentCard");

    if (selfP) {
      let extra = "";
      if (room.game_type === "othello" && room.counts) extra = ` • ${room.counts[selfP.role] ?? 0}`;
      selfCard.querySelector(".p-name").textContent = `${selfP.name} (${selfP.role})${extra}`;
      selfCard.querySelector(".p-elo").textContent = `${selfP.elo} ELO`;
      selfCard.querySelector(".p-clock").textContent = formatClock(selfP.clock);
      selfCard.classList.toggle("active-turn", room.status === "active" && room.turn_role === selfP.role);
    }

    if (oppP) {
      let extra = "";
      if (room.game_type === "othello" && room.counts) extra = ` • ${room.counts[oppP.role] ?? 0}`;
      oppCard.querySelector(".p-name").textContent = `${oppP.name} (${oppP.role})${extra}`;
      oppCard.querySelector(".p-elo").textContent = oppP.is_ai ? "AI" : `${oppP.elo} ELO`;
      oppCard.querySelector(".p-clock").textContent = oppP.is_ai ? "∞" : formatClock(oppP.clock);
      oppCard.classList.toggle("active-turn", room.status === "active" && room.turn_role === oppP.role);
    } else {
      oppCard.querySelector(".p-name").textContent = "Waiting for opponent...";
      oppCard.querySelector(".p-elo").textContent = "-- ELO";
      oppCard.querySelector(".p-clock").textContent = "--:--";
      oppCard.classList.remove("active-turn");
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

    document.getElementById("btnResign").classList.toggle("hidden", isSpectator || room.status !== "active");
    document.getElementById("btnRematch").classList.toggle("hidden", isSpectator || room.status !== "finished");

    const container = document.getElementById("boardContainer");
    container.innerHTML = "";

    if (room.game_type === "chess") renderChessBoard(container, room, selfP, myTurn);
    else if (room.game_type === "othello") renderOthelloBoard(container, room, myTurn);
    else if (room.game_type === "connect4") renderConnect4Board(container, room, myTurn);
    else renderTicTacToeBoard(container, room, myTurn);
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

        sqEl.innerHTML = (piece ? pieceSvg(piece) : "") + `<span class="chess-coord">${sq.toUpperCase()}</span>`;

        sqEl.addEventListener("click", () => {
          if (!myTurn) return;
          if (state.selectedSquare && legalTargets.has(sq)) {
            haptic("medium");
            sendWs({ type: "move", uci: `${state.selectedSquare}${sq}` });
            state.selectedSquare = null;
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
    boardEl.className = "c4-board";
    room.state.board.forEach((row) => {
      row.forEach((cell, col) => {
        const cellEl = document.createElement("div");
        cellEl.className = `c4-cell ${cell}`;
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

  function renderTicTacToeBoard(container, room, myTurn) {
    const boardEl = document.createElement("div");
    boardEl.className = "ttt-board";
    room.state.board.forEach((cell, index) => {
      const cellEl = document.createElement("div");
      cellEl.className = "ttt-cell";
      cellEl.textContent = cell === "X" ? "❌" : cell === "O" ? "⭕" : "";
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
        (p, idx) => `
      <div class="lb-row">
        <span>#${idx + 1} ${p.tier?.icon || "🥉"} <strong>${p.display_name}</strong> (Lv${p.level || 1})</span>
        <span>${Math.round(p.elo)} ELO • ${p.wins}W/${p.losses}L</span>
      </div>`
      )
      .join("");
  }

  function selectGame(game) {
    state.selectedGame = game;
    document.querySelectorAll(".game-pill").forEach((b) => {
      b.classList.toggle("selected", b.dataset.game === game);
    });
  }

  // Navigation
  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const v = item.dataset.view;
      state.prevView = v;
      showView(v);
      if (v === "home") refreshLiveRooms();
      if (v === "ranks") loadLeaderboard();
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

  document.getElementById("btnQuickMatch").addEventListener("click", () => startRoomRequest({ quick_match: true }));
  document.getElementById("btnVsAi").addEventListener("click", () => startRoomRequest({ vs_ai: true }));
  document.getElementById("btnCreateRoom").addEventListener("click", () => startRoomRequest({ quick_match: false }));
  document.getElementById("btnJoinRoom").addEventListener("click", () => joinRoom(document.getElementById("roomCodeInput").value));

  document.getElementById("btnLeaveRoom").addEventListener("click", () => {
    if (state.ws) state.ws.close();
    if (state.clockTimer) clearInterval(state.clockTimer);
    showView(state.prevView || "home");
    refreshLiveRooms();
  });

  document.getElementById("btnCopyInvite").addEventListener("click", async () => {
    if (!state.room) return;
    const code = state.room.room_id;
    const shareUrl = state.botUsername
      ? `https://t.me/${state.botUsername}?startapp=room_${code}`
      : `${window.location.origin}/?room=${code}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      document.getElementById("btnCopyInvite").textContent = "✅ Copied";
      setTimeout(() => { document.getElementById("btnCopyInvite").textContent = "📤 Invite"; }, 1500);
    } catch (_) {
      alert(`Room Code: ${code}\nLink: ${shareUrl}`);
    }
  });

  document.getElementById("btnResign").addEventListener("click", () => sendWs({ type: "resign" }));
  document.getElementById("btnRematch").addEventListener("click", () => sendWs({ type: "rematch" }));
  document.getElementById("btnRefreshLb").addEventListener("click", loadLeaderboard);
  document.getElementById("btnRefreshLive").addEventListener("click", refreshLiveRooms);
  document.getElementById("btnRefreshProfile").addEventListener("click", refreshProfileAndHistory);

  async function loadCustomGames() {
    const el = document.getElementById("customGamesGrid");
    try {
      const res = await fetch("/api/custom-games");
      const data = await res.json();
      if (!data.games.length) {
        el.innerHTML = `
          <div style="grid-column: 1 / -1; color: var(--muted); font-size: 0.8rem; padding: 6px 0;">
            No web games added yet.${state.isAdmin ? " Tap <strong>⚙️ Add Game</strong> above to add one!" : ""}
          </div>`;
        return;
      }
      el.innerHTML = data.games
        .map(
          (g) => `
        <button class="custom-game-card" data-url="${encodeURI(g.url)}" data-title="${g.title}" data-icon="${g.icon}">
          <div class="cgc-icon">${g.icon || "🎮"}</div>
          <div class="cgc-title">${g.title}</div>
          <div class="cgc-desc">${g.description || "Tap to play web game"}</div>
        </button>`
        )
        .join("");

      el.querySelectorAll(".custom-game-card").forEach((card) => {
        card.addEventListener("click", () => {
          haptic("medium");
          launchWebGame(card.dataset.title, card.dataset.url, card.dataset.icon);
        });
      });
    } catch (_) {
      el.textContent = "Could not load web games.";
    }
  }

  function launchWebGame(title, url, icon = "🎮") {
    state.currentGameUrl = url;
    document.getElementById("gamePlayerTitle").textContent = `${icon} ${title}`;
    document.getElementById("customGameIframe").src = url;
    state.prevView = "home";
    showView("player");
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
        (g) => `
      <div class="admin-game-row">
        <span>${g.icon} <strong>${g.title}</strong></span>
        <button class="btn small danger" data-del="${g.id}">🗑️</button>
      </div>`
      )
      .join("");

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

  document.getElementById("btnCloseGamePlayer").addEventListener("click", () => {
    document.getElementById("customGameIframe").src = "";
    state.currentGameUrl = "";
    showView(state.prevView || "home");
  });

  document.getElementById("btnOpenExternal").addEventListener("click", () => {
    if (!state.currentGameUrl) return;
    if (tg?.openLink) tg.openLink(state.currentGameUrl);
    else window.open(state.currentGameUrl, "_blank");
  });

  document.getElementById("btnOpenAddGameModal").addEventListener("click", () => {
    document.getElementById("modalAddGame").classList.remove("hidden");
    loadAdminGamesList();
  });

  document.getElementById("btnCloseModal").addEventListener("click", () => {
    document.getElementById("modalAddGame").classList.add("hidden");
  });

  document.getElementById("formAddGame").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("inputGameTitle").value.trim();
    const url = document.getElementById("inputGameUrl").value.trim();
    const icon = document.getElementById("inputGameIcon").value.trim() || "🎮";
    const description = document.getElementById("inputGameDesc").value.trim();
    const admin_secret = document.getElementById("inputAdminSecret").value.trim();

    const res = await fetch("/api/admin/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        url,
        icon,
        description,
        user_id: state.userId,
        admin_secret,
      }),
    });
    if (res.ok) {
      document.getElementById("inputGameTitle").value = "";
      document.getElementById("inputGameUrl").value = "";
      document.getElementById("inputGameDesc").value = "";
      loadAdminGamesList();
      loadCustomGames();
      alert("✅ Game successfully added to Mini App!");
    } else {
      const err = await res.json();
      alert(`Error: ${err.detail || "Could not add game."}`);
    }
  });

  initAuth();
})();
