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
  };

  function showView(name) {
    Object.entries(views).forEach(([k, el]) => {
      if (el) el.classList.toggle("active", k === name);
    });
    navItems.forEach((n) => n.classList.toggle("active", n.dataset.view === name));
    
    const isFullscreen = name === "match" || name === "player";
    document.getElementById("bottomNav")?.classList.toggle("hidden", isFullscreen);
    document.querySelector(".topbar")?.classList.toggle("hidden", isFullscreen);

    if (isFullscreen || name === "battle") {
      try { tg?.expand(); } catch (_) {}
      try { if (tg?.requestFullscreen) tg.requestFullscreen(); } catch (_) {}
    }

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
    if (!data.history.length) {
      histEl.innerHTML = `<div style="text-align:center;color:var(--muted);padding:14px;font-size:0.85rem;">No ranked PvP matches played yet.<br>Jump into the <strong>Battle</strong> tab to play!</div>`;
      return;
    }
    histEl.innerHTML = data.history
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
                <div class="hi-opp">vs ${opp}</div>
                <div class="hi-game">${(m.game_type || "pvp").toUpperCase()}</div>
              </div>
            </div>
            <div class="hi-delta ${delta >= 0 ? 'pos' : 'neg'}">${deltaStr} ELO</div>
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

    const isArcade = room.game_type === "knife_hit" || room.game_type === "fruit_slice";
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
    const gamePath = room.game_type === "knife_hit" ? "/static/games/knife_hit/index.html" : "/static/games/fruit_slice/index.html";
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

  // Theme toggle (3D Clay Pastel <-> Dark Esports)
  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("clay_theme", theme); } catch (_) {}
    const btn = document.getElementById("btnThemeToggle");
    if (btn) btn.textContent = theme === "clay" ? "🌙" : "✨";
  }
  const savedTheme = (() => {
    try { return localStorage.getItem("clay_theme") || "clay"; } catch (_) { return "clay"; }
  })();
  applyTheme(savedTheme);

  document.getElementById("btnThemeToggle")?.addEventListener("click", () => {
    haptic("light");
    applyTheme(state.theme === "clay" ? "dark" : "clay");
  });

  // Category & search filtering for 50+ HTML5 games
  function classifyGameCategory(g) {
    const t = `${g.title} ${g.description}`.toLowerCase();
    if (/puzzle|wordle|sudoku|minesweeper|2048|crossword|nonogram|hanoi|flood|matrix|memory|hextris|15 puzzle/.test(t)) return "puzzle";
    if (/sport|billiards|pool|pong|golf|soccer|basketball|hockey|tennis/.test(t)) return "sport";
    if (/arcade|pac-man|pacman|dino|flappy|jump|tower|breakout|invaders|asteroids|snake|pinball|duck|mole|geometry|fruit|knife|slither|paper|helix/.test(t)) return "arcade";
    if (/solitaire|card|mahjong|checkers|reversi|othello|backgammon|domino|yahtzee|hearts|spades|rummy|cribbage|freecell/.test(t)) return "cards";
    return "casual";
  }

  function renderFilteredGames() {
    const el = document.getElementById("customGamesGrid");
    if (!el) return;
    const cat = state.gameFilterCat || "all";
    const q = (state.gameSearchQuery || "").toLowerCase().trim();

    const filtered = (state.allCustomGames || []).filter((g) => {
      const matchCat = cat === "all" || classifyGameCategory(g) === cat;
      const matchQ = !q || g.title.toLowerCase().includes(q) || (g.description && g.description.toLowerCase().includes(q));
      return matchCat && matchQ;
    });

    const countEl = document.getElementById("totalGamesCount");
    if (countEl) countEl.textContent = `${state.allCustomGames.length}`;

    if (!filtered.length) {
      el.innerHTML = `
        <div class="empty-games-hint">
          No games found matching "${q}". Try another search keyword!
        </div>`;
      return;
    }

    el.innerHTML = filtered
      .map(
        (g) => `
      <button class="custom-game-card" data-url="${encodeURI(g.url)}" data-title="${g.title}" data-icon="${g.icon}">
        <div class="cgc-top">
          <div class="cgc-icon">
            ${g.image_url ? `<img src="${g.image_url}" class="cgc-box-img" alt="${g.title}" />` : (g.icon || "🎮")}
          </div>
          <span class="cgc-play-badge">PLAY</span>
        </div>
        <div class="cgc-body">
          <div class="cgc-title">${g.title}</div>
          <div class="cgc-desc">${g.description || "Tap to play instantly"}</div>
        </div>
      </button>`
      )
      .join("");

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

    row.innerHTML = displayList.map(g => `
      <button class="carousel-game-card" data-url="${encodeURI(g.url)}" data-title="${g.title}" data-icon="${g.icon}">
        <div class="cgc-thumb-wrap">
          ${g.image_url ? `<img src="${g.image_url}" class="cgc-thumb-img" alt="${g.title}" />` : `<span class="cgc-art">${g.icon || "🎮"}</span>`}
        </div>
        <div class="cgc-card-title">${g.title}</div>
        <div class="cgc-card-tag">${classifyGameCategory(g).toUpperCase()}</div>
      </button>
    `).join("");

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

    list.innerHTML = trendingList.map((g, idx) => `
      <div class="trending-game-card" data-url="${encodeURI(g.url)}" data-title="${g.title}" data-icon="${g.icon}">
        <div class="tgc-left">
          <div class="tgc-thumb">
            ${g.image_url ? `<img src="${g.image_url}" class="tgc-thumb-img" alt="${g.title}" />` : (g.icon || "🎮")}
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
    `).join("");

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
    { title: "Aviator Rocket", url: "/static/games/aviator/index.html", icon: "🚀", description: "High-stakes rocket multiplier curve! Cash out before blast", image_url: "/static/banners/aviator_promo.png" },
    { title: "Knife Master", url: "/static/games/knife_hit/index.html", icon: "🗡️", description: "Throw knives into rotating target log", image_url: "/static/thumbnails/knife_thumb.png" },
    { title: "Fruit Slicer", url: "/static/games/fruit_slice/index.html", icon: "🍉", description: "Slice flying fruits with swipe blades", image_url: "/static/thumbnails/fruit_thumb.png" },
    { title: "2048 Classic", url: "/static/games/2048/index.html", icon: "🔢", description: "Slide tiles to merge and reach 2048!", image_url: "/static/banners/puzzle2048_promo.png" },
    { title: "Retro Tetris", url: "/static/games/tetris/index.html", icon: "🧩", description: "Falling tetromino block puzzle", image_url: "/static/banners/tetris_promo.png" },
    { title: "T-Rex Desert Run", url: "/static/games/dino/index.html", icon: "🦖", description: "Endless runner cactus jumping challenge", image_url: "/static/banners/dino_promo.png" },
    { title: "Neon Snake", url: "/static/games/snake/index.html", icon: "🐍", description: "Classic retro snake with smooth controls", image_url: "" },
    { title: "Space Invaders", url: "/static/games/space_invaders/index.html", icon: "👾", description: "Defend galaxy from alien waves", image_url: "/static/banners/space_promo.png" },
    { title: "Connect 4 Arena", url: "/static/games/connect4/index.html", icon: "🔴", description: "Align 4 chips in a row against AI", image_url: "/static/thumbnails/connect4_thumb.png" },
    { title: "Neon Tic-Tac-Toe", url: "/static/games/tictactoe/index.html", icon: "❌", description: "Glowing neon 3x3 XO against unbeatable AI", image_url: "/static/thumbnails/xo_thumb.png" },
  ];

  async function loadCustomGames() {
    const el = document.getElementById("customGamesGrid");
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const res = await fetch("/api/custom-games", { signal: controller.signal });
      clearTimeout(timer);
      const data = await res.json();
      state.allCustomGames = data.games && data.games.length ? data.games : FALLBACK_DEFAULT_GAMES;
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

  function exitGameToHome() {
    const iframe = document.getElementById("customGameIframe");
    if (iframe) iframe.src = "";
    state.currentGameUrl = "";
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
    const iframe = document.getElementById("customGameIframe");
    if (iframe) iframe.src = url;

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
          psoSub.textContent = "⏱️ 3:00 Mins • Slice Fruits & Combos • 3 Lives • AVOID BOMBS!";
        } else if (title.toLowerCase().includes("knife")) {
          psoSub.textContent = "⏱️ 3:00 Mins • Hit rotating target • Don't clash blades • 15+ Levels!";
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
  });

  // Hero Sliding Window Carousel Control
  let heroCurrentSlide = 0;
  const heroTotalSlides = 4;
  let heroAutoSlideInterval = null;

  function setHeroSlide(idx) {
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
    heroAutoSlideInterval = setInterval(() => {
      setHeroSlide(heroCurrentSlide + 1);
    }, 4500);
  }

  document.querySelectorAll(".carousel-dot").forEach((dot) => {
    dot.addEventListener("click", () => {
      haptic("light");
      const idx = parseInt(dot.dataset.index, 10);
      setHeroSlide(idx);
      startHeroAutoSlide();
    });
  });
  startHeroAutoSlide();

  // Hero Play buttons for each slide
  document.getElementById("btnPlayAviatorHero")?.addEventListener("click", () => {
    haptic("heavy");
    launchWebGame("Aviator Rocket", "/static/games/aviator/index.html", "🚀");
  });
  document.getElementById("btnPlaySpeedwayHero")?.addEventListener("click", () => {
    haptic("heavy");
    launchWebGame("T-Rex Desert Run", "/static/games/dino/index.html", "🦖");
  });
  document.getElementById("btnPlayInvadersHero")?.addEventListener("click", () => {
    haptic("heavy");
    launchWebGame("Space Invaders", "/static/games/space_invaders/index.html", "👾");
  });
  document.getElementById("btnPlayTetrisHero")?.addEventListener("click", () => {
    haptic("heavy");
    launchWebGame("Retro Tetris", "/static/games/tetris/index.html", "🧩");
  });

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
    flappy: { title: "Flappy Ghost", url: "/static/games/flappy/index.html", icon: "👻" },
    breakout: { title: "Neon Breakout", url: "/static/games/breakout/index.html", icon: "🧱" },
    snake: { title: "Retro Snake", url: "/static/games/snake/index.html", icon: "🐍" },
    helix_jump: { title: "Helix Spiral", url: "/static/games/helix_jump/index.html", icon: "🌀" },
    fruit_slice: { title: "Fruit Ninja", url: "/static/games/fruit_slice/index.html", icon: "🍉" },
    tower_stack: { title: "Tower Stack", url: "/static/games/tower_stack/index.html", icon: "🏗️" },
    minesweeper: { title: "Minesweeper Pro", url: "/static/games/minesweeper/index.html", icon: "💣" },
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
            ? `<img src="${g.image_url}" style="width:24px;height:24px;border-radius:6px;object-fit:cover;vertical-align:middle;margin-right:6px;" alt="">`
            : `<span style="font-size:1.1rem;margin-right:6px;">${g.icon || "🎮"}</span>`;
          return `
      <div class="admin-game-row">
        <span>${logoEl} <strong>${g.title}</strong></span>
        <button class="btn small danger" data-del="${g.id}">🗑️</button>
      </div>`;
        }
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

  document.getElementById("btnCloseGamePlayer")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    exitGameToHome();
  });

  const modalAddGame = document.getElementById("modalAddGame");
  const btnOpenAddGameModal = document.getElementById("btnOpenAddGameModal");
  const btnNavAddGame = document.getElementById("btnNavAddGame");
  const btnShortcutAddGame = document.getElementById("btnShortcutAddGame");
  const btnCloseModal = document.getElementById("btnCloseModal");

  function closeModal() {
    if (modalAddGame) modalAddGame.classList.add("hidden");
  }

  function openAddGameModal() {
    modalAddGame?.classList.remove("hidden");
    loadAdminGamesList();
  }

  btnOpenAddGameModal?.addEventListener("click", openAddGameModal);
  btnNavAddGame?.addEventListener("click", openAddGameModal);
  btnShortcutAddGame?.addEventListener("click", openAddGameModal);

  btnCloseModal?.addEventListener("click", closeModal);

  // Close when clicking outside the modal content (on the backdrop)
  modalAddGame?.addEventListener("click", (e) => {
    if (e.target === modalAddGame) {
      closeModal();
    }
  });

  // Close on Escape key press
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
    }
  });

  const inputGameLogoFile = document.getElementById("inputGameLogoFile");
  const inputGameLogoUrl = document.getElementById("inputGameLogoUrl");
  const previewLogoImg = document.getElementById("previewLogoImg");
  const previewEmoji = document.getElementById("previewEmoji");

  let logoFocal = { x: 50, y: 50 };
  let originalRawLogoSrc = "";

  const sliderFocalX = document.getElementById("sliderFocalX");
  const sliderFocalY = document.getElementById("sliderFocalY");
  const valFocalX = document.getElementById("valFocalX");
  const valFocalY = document.getElementById("valFocalY");
  const lblFocalValue = document.getElementById("lblFocalValue");

  function setLogoFocal(x, y) {
    logoFocal.x = Math.max(0, Math.min(100, x));
    logoFocal.y = Math.max(0, Math.min(100, y));
    if (sliderFocalX) sliderFocalX.value = logoFocal.x;
    if (sliderFocalY) sliderFocalY.value = logoFocal.y;
    if (valFocalX) valFocalX.textContent = `${logoFocal.x}%`;
    if (valFocalY) valFocalY.textContent = `${logoFocal.y}%`;
    if (lblFocalValue) lblFocalValue.textContent = `${logoFocal.x}% ${logoFocal.y}%`;
    if (previewLogoImg) {
      previewLogoImg.style.objectPosition = `${logoFocal.x}% ${logoFocal.y}%`;
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
      setLogoFocal(fx, fy);
    });
  });

  sliderFocalX?.addEventListener("input", (e) => {
    setLogoFocal(parseInt(e.target.value, 10), logoFocal.y);
  });
  sliderFocalY?.addEventListener("input", (e) => {
    setLogoFocal(logoFocal.x, parseInt(e.target.value, 10));
  });

  function cropImageWithFocal(imgSrc, fx, fy) {
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
          const side = Math.min(srcW, srcH);

          const cropX = ((srcW - side) * fx) / 100;
          const cropY = ((srcH - side) * fy) / 100;

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

  document.getElementById("formAddGame").addEventListener("submit", async (e) => {
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
        const croppedBase64 = await cropImageWithFocal(sourceImage, logoFocal.x, logoFocal.y);
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

    const res = await fetch("/api/admin/games", {
      method: "POST",
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
      document.getElementById("inputGameTitle").value = "";
      document.getElementById("inputGameUrl").value = "";
      document.getElementById("inputGameDesc").value = "";
      if (inputGameLogoUrl) inputGameLogoUrl.value = "";
      if (inputGameLogoFile) inputGameLogoFile.value = "";
      originalRawLogoSrc = "";
      setLogoFocal(50, 50);
      updateLogoPreview("");
      loadAdminGamesList();
      loadCustomGames();
      alert("✅ Game successfully added to Mini App!");
    } else {
      const err = await res.json();
      alert(`Error: ${err.detail || "Could not add game."}`);
    }
  });

  loadCustomGames();
  initAuth();

  if (window.lucide) {
    window.lucide.createIcons();
  }
})();
