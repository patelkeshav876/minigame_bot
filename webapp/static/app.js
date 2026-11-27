(() => {
  const tg = window.Telegram ? window.Telegram.WebApp : null;
  if (tg) {
    tg.ready();
    tg.expand();
  }

  // Universal HTML sanitizer
  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  window.escapeHtml = escapeHtml;

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
    setTimeout(initBubbleText, 30);
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
    const profWalletCoins = document.getElementById("profWalletCoins");
    if (profWalletCoins) profWalletCoins.textContent = `🪙 ${Number(storedCoins).toLocaleString()}`;
    const energyValEl = document.getElementById("energyVal");
    if (energyValEl) energyValEl.textContent = "25";

    const pct = Math.min(100, Math.round(((profile.xp_progress || 0) / (profile.xp_next || 100)) * 100));

    // Profile View Elements
    const pName = document.getElementById("profPlayerName");
    if (pName) pName.textContent = profile.display_name || "Player";
    const pTier = document.getElementById("profTierBadge");
    if (pTier) pTier.textContent = `${profile.tier?.icon || "🥉"} ${profile.tier?.name || "Bronze"}`;
    const pElo = document.getElementById("profGlobalElo");
    if (pElo) pElo.textContent = `${elo} ELO`;
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

    // Update Simey 3D Holographic Member Card
    const savedAvatar = localStorage.getItem("minigame_prof_avatar") || "";
    const tgPhoto = tg?.initDataUnsafe?.user?.photo_url || "";
    const avatarUrl = savedAvatar || tgPhoto || "/static/bot_avatar.jpg";
    const holoAvatar = document.getElementById("holoCardAvatar");
    if (holoAvatar) holoAvatar.src = avatarUrl;

    const handleStr = profile.username
      ? `@${profile.username}`
      : `@${(profile.display_name || "player").toLowerCase().replace(/[^a-z0-9_]/g, "") || "player"}`;
    const holoHandle = document.getElementById("holoCardHandle");
    if (holoHandle) holoHandle.textContent = handleStr;

    const holoSub = document.getElementById("holoCardSubline");
    if (holoSub) holoSub.textContent = `LVL ${profile.level || 1} • ${total} Played (${profile.wins || 0}W/${profile.losses || 0}L)`;

    const tierLabel = elo >= 1500 ? "LEGEND" : elo >= 1350 ? "MASTER" : elo >= 1220 ? "PRO" : "VIP";
    const holoTier = document.getElementById("holoCardTier");
    if (holoTier) holoTier.textContent = tierLabel;

    // Back of Card
    const bId = document.getElementById("holoBackId");
    if (bId) bId.textContent = `#${String(profile.user_id || "0000").slice(-6)}`;
    const bName = document.getElementById("holoBackName");
    if (bName) bName.textContent = profile.display_name || "Player";
    const bTier = document.getElementById("holoBackTier");
    if (bTier) bTier.textContent = `${profile.tier?.icon || "🥉"} ${profile.tier?.name || "Bronze"}`;
    const bMatches = document.getElementById("holoBackMatches");
    if (bMatches) bMatches.textContent = total;
    const bWr = document.getElementById("holoBackWinRate");
    if (bWr) bWr.textContent = `${wr}%`;
    const bCoins = document.getElementById("holoBackCoins");
    if (bCoins) bCoins.textContent = Number(storedCoins).toLocaleString();
    const bSub = document.getElementById("holoBackSub");
    if (bSub && typeof getStickerSubscriptionStatus === "function") {
      bSub.textContent = getStickerSubscriptionStatus().label;
    }
    const bBio = document.getElementById("holoBackBio");
    const savedBio = localStorage.getItem("minigame_prof_bio") || "Ready to dominate the arena!";
    if (bBio) bBio.textContent = `"${savedBio}"`;

    // Apply Saved Card Skin
    applyHoloCardSkin(localStorage.getItem("minigame_card_skin") || "crown");

    // Update Daily Bonus Button State
    updateDailyBonusBtnState();

    // Update Badges Showcase
    renderProfileBadges(profile, total, Number(storedCoins));

    const gr = profile.game_ratings || {};
    ["chess", "othello", "connect4", "tictactoe"].forEach((g) => {
      const span = document.querySelector(`[data-elo="${g}"]`);
      if (span) {
        const gElo = gr[g] ? Math.round(gr[g].elo) : 1200;
        span.textContent = `${gElo} ELO`;
      }
    });
  }

  const HOLO_SKINS = ["crown", "gold", "cyber", "matrix"];
  const HOLO_SKIN_LABELS = {
    crown: "🎨 Crown",
    gold: "🎨 Gold",
    cyber: "🎨 Cyber",
    matrix: "🎨 Matrix",
  };

  function applyHoloCardSkin(skin) {
    const card = document.getElementById("profileHoloCard");
    if (!card) return;
    HOLO_SKINS.forEach((s) => card.classList.remove(`skin-${s}`));
    const valid = HOLO_SKINS.includes(skin) ? skin : "crown";
    card.classList.add(`skin-${valid}`);
    localStorage.setItem("minigame_card_skin", valid);
    const btn = document.getElementById("btnCycleCardSkin");
    if (btn) btn.textContent = HOLO_SKIN_LABELS[valid] || "🎨 Skin";
  }

  function updateDailyBonusBtnState() {
    const btn = document.getElementById("btnClaimDailyBonus");
    if (!btn) return;
    const today = new Date().toISOString().slice(0, 10);
    const lastClaim = localStorage.getItem("minigame_daily_claim_date");
    if (lastClaim === today) {
      btn.textContent = "✅ Claimed";
      btn.disabled = true;
      btn.style.opacity = "0.65";
    } else {
      btn.textContent = "🎁 Daily +250";
      btn.disabled = false;
      btn.style.opacity = "1";
    }
  }

  function renderProfileBadges(profile, totalMatches, coins) {
    const grid = document.getElementById("profileBadgesGrid");
    if (!grid) return;
    const elo = Math.round(profile.elo || 1200);
    const wins = profile.wins || 0;
    const badges = [
      { icon: "⚔️", title: "First Blood", desc: "Play 1 Arena match", unlocked: totalMatches >= 1 },
      { icon: "🏆", title: "Victor", desc: "Win 3 Arena matches", unlocked: wins >= 3 },
      { icon: "🔥", title: "Gladiator", desc: "Play 10+ total matches", unlocked: totalMatches >= 10 },
      { icon: "👑", title: "Master Tier", desc: "Reach 1300+ ELO", unlocked: elo >= 1300 },
      { icon: "💎", title: "High Roller", desc: "Hold 2,000+ Coins", unlocked: coins >= 2000 },
      { icon: "⭐", title: "Level 5 Pro", desc: "Reach Player Level 5", unlocked: (profile.level || 1) >= 5 },
    ];
    grid.innerHTML = badges
      .map(
        (b) => `
        <div class="badge-tile ${b.unlocked ? "unlocked" : "locked"}">
          <div class="bt-icon">${b.icon}</div>
          <div class="bt-title">${b.title}</div>
          <div class="bt-desc">${b.desc}</div>
          <div class="bt-status">${b.unlocked ? "✓ UNLOCKED" : "🔒 LOCKED"}</div>
        </div>`
      )
      .join("");
  }

  function attachHoloTilt(cardEl) {
    if (!cardEl || cardEl.dataset.holoWired === "true") return;
    cardEl.dataset.holoWired = "true";

    const updateTilt = (clientX, clientY) => {
      if (cardEl.classList.contains("is-flipped")) return;
      const rect = cardEl.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      const rx = (0.5 - y) * 24;
      const ry = (x - 0.5) * 24;
      cardEl.classList.add("is-tilting");
      cardEl.style.setProperty("--rx", `${rx.toFixed(2)}deg`);
      cardEl.style.setProperty("--ry", `${ry.toFixed(2)}deg`);
      cardEl.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
      cardEl.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
      cardEl.style.setProperty("--px", `${(x * 100).toFixed(1)}%`);
      cardEl.style.setProperty("--py", `${(y * 100).toFixed(1)}%`);
    };

    const resetTilt = () => {
      cardEl.classList.remove("is-tilting");
      cardEl.style.setProperty("--rx", "0deg");
      cardEl.style.setProperty("--ry", "0deg");
      cardEl.style.setProperty("--mx", "50%");
      cardEl.style.setProperty("--my", "50%");
    };

    cardEl.addEventListener("mousemove", (e) => updateTilt(e.clientX, e.clientY));
    cardEl.addEventListener("mouseleave", resetTilt);
    cardEl.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches && e.touches[0]) {
          updateTilt(e.touches[0].clientX, e.touches[0].clientY);
        }
      },
      { passive: true }
    );
    cardEl.addEventListener("touchend", resetTilt);
  }

  async function loadMembersHoloCards() {
    const grid = document.getElementById("membersHoloGrid");
    if (!grid) return;
    grid.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;padding:12px;">Loading member cards...</div>';
    try {
      const res = await fetch("/api/leaderboard?game_type=overall");
      if (!res.ok) {
        grid.innerHTML = '<div style="color:#ef4444;font-size:0.85rem;padding:12px;">Could not load members.</div>';
        return;
      }
      const data = await res.json();
      const players = data.players || [];
      if (!players.length) {
        grid.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;padding:12px;">No members registered yet.</div>';
        return;
      }
      const skins = ["skin-crown", "skin-gold", "skin-cyber", "skin-matrix"];
      grid.innerHTML = "";
      players.forEach((p, idx) => {
        const elo = Math.round(p.elo || 1200);
        const tierLabel = elo >= 1500 ? "LEGEND" : elo >= 1350 ? "MASTER" : elo >= 1220 ? "PRO" : "VIP";
        const handle = p.username
          ? `@${p.username}`
          : `@${(p.display_name || "player").toLowerCase().replace(/[^a-z0-9_]/g, "") || "player"}`;
        const skinClass = skins[idx % skins.length];

        const scene = document.createElement("div");
        scene.className = "member-mini-scene";
        scene.innerHTML = `
          <div class="member-mini-card holo-card ${skinClass}" style="width:100%;height:205px;">
            <div class="holo-foil-layer"></div>
            <div class="holo-glare-layer"></div>
            <div class="mmc-rank-tag">#${idx + 1}</div>
            <img src="/static/bot_avatar.jpg" class="mmc-avatar" alt="${escapeHtml(p.display_name)}" />
            <div class="mmc-handle">${escapeHtml(handle)}</div>
            <div class="mmc-elo">${elo} ELO • ${p.wins || 0}W</div>
            <div class="mmc-pill">${tierLabel}</div>
          </div>
        `;
        const card = scene.querySelector(".member-mini-card");
        attachHoloTilt(card);
        card.addEventListener("click", () => {
          haptic("light");
          triggerMagicalScreenReaction({
            type: "reaction",
            emoji: idx === 0 ? "👑" : "⚡",
            fx: idx === 0 ? "rain" : "float",
            senderName: p.display_name || handle,
            isSelf: false,
          });
        });
        grid.appendChild(scene);
      });
    } catch (e) {
      grid.innerHTML = `<div style="color:#ef4444;font-size:0.85rem;padding:12px;">Error: ${escapeHtml(e.message)}</div>`;
    }
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
        const played = (item.wins || 0) + (item.losses || 0) + (item.draws || 0);
        if (g === "chess") {
          return `
            <div class="rating-box">
              <div class="rb-icon">${icon}</div>
              <div class="rb-title">${gName}</div>
              <div class="rb-elo">${item.tier?.icon || "🥉"} ${Math.round(item.elo)} ELO</div>
              <div class="rb-record">${played} Played • ${item.wins}W / ${item.losses}L</div>
            </div>`;
        }
        return `
          <div class="rating-box">
            <div class="rb-icon">${icon}</div>
            <div class="rb-title">${gName}</div>
            <div class="rb-elo" style="color:#38bdf8;">${played} Played</div>
            <div class="rb-record">${item.wins}W • ${item.losses}L${item.draws ? ` • ${item.draws}D` : ""}</div>
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
      } else if (msg.type === "reaction" || msg.type === "sticker") {
        appendMatchChatMessage(msg);
        triggerMagicalScreenReaction({
          type: msg.type,
          emoji: msg.emoji,
          sticker_id: msg.sticker_id,
          fx: msg.fx,
          senderName: msg.sender_name,
          isSelf: msg.sender_id === state.userId,
        });
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

  // =========================================================
  // TELEGRAM PREMIUM STICKERS & MAGICAL FULLSCREEN REACTIONS
  // =========================================================
  const MINIGAME_STICKERS = {
    bot_gg: {
      id: "bot_gg",
      title: "GG EASY",
      tag: "Victory King",
      emoji: "👑",
      fx: "rain",
      svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="stk_gold" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fef08a"/>
            <stop offset="50%" stop-color="#eab308"/>
            <stop offset="100%" stop-color="#ca8a04"/>
          </linearGradient>
          <linearGradient id="stk_cyan" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#67e8f9"/>
            <stop offset="100%" stop-color="#0284c7"/>
          </linearGradient>
        </defs>
        <circle cx="50" cy="54" r="38" fill="rgba(234, 179, 8, 0.15)" stroke="url(#stk_gold)" stroke-width="2.5" stroke-dasharray="6 3"/>
        <rect x="26" y="38" width="48" height="38" rx="14" fill="#0f172a" stroke="url(#stk_cyan)" stroke-width="3"/>
        <rect x="32" y="47" width="36" height="12" rx="6" fill="#0284c7"/>
        <circle cx="41" cy="53" r="3" fill="#ffffff"/>
        <circle cx="59" cy="53" r="3" fill="#ffffff"/>
        <path d="M40 68 Q50 74 60 68" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" fill="none"/>
        <rect x="19" y="48" width="7" height="16" rx="3.5" fill="url(#stk_gold)"/>
        <rect x="74" y="48" width="7" height="16" rx="3.5" fill="url(#stk_gold)"/>
        <path d="M28 36 L34 18 L50 28 L66 18 L72 36 Z" fill="url(#stk_gold)" stroke="#78350f" stroke-width="1.5" stroke-linejoin="round"/>
        <circle cx="34" cy="18" r="3" fill="#ef4444"/>
        <circle cx="50" cy="27" r="3.5" fill="#38bdf8"/>
        <circle cx="66" cy="18" r="3" fill="#10b981"/>
        <rect x="37" y="78" width="26" height="14" rx="4" fill="url(#stk_gold)"/>
        <text x="50" y="89" font-size="9" font-weight="900" fill="#78350f" text-anchor="middle" font-family="sans-serif">GG</text>
      </svg>`,
    },
    bot_fire: {
      id: "bot_fire",
      title: "ON FIRE",
      tag: "Hyperspeed",
      emoji: "🔥",
      fx: "float",
      svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="stk_fire" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#ef4444"/>
            <stop offset="50%" stop-color="#f97316"/>
            <stop offset="100%" stop-color="#fde047"/>
          </linearGradient>
        </defs>
        <path d="M50 8 Q68 28 64 48 Q76 42 74 64 Q80 84 50 96 Q20 84 26 64 Q24 42 36 48 Q32 28 50 8 Z" fill="url(#stk_fire)" opacity="0.95"/>
        <path d="M50 24 Q60 38 56 52 Q64 48 62 64 Q66 78 50 86 Q34 78 38 64 Q36 48 44 52 Q40 38 50 24 Z" fill="#fef08a"/>
        <rect x="33" y="44" width="34" height="30" rx="9" fill="#0f172a" stroke="#ffffff" stroke-width="2.5"/>
        <path d="M36 52 L48 52 L46 61 L38 61 Z" fill="#1e293b" stroke="#f97316" stroke-width="1.5"/>
        <path d="M52 52 L64 52 L62 61 L54 61 Z" fill="#1e293b" stroke="#f97316" stroke-width="1.5"/>
        <line x1="48" y1="54" x2="52" y2="54" stroke="#f97316" stroke-width="2"/>
        <path d="M38 54 L44 54" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M54 54 L60 54" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M43 68 Q50 72 57 68" stroke="#fde047" stroke-width="2" stroke-linecap="round" fill="none"/>
      </svg>`,
    },
    bot_rocket: {
      id: "bot_rocket",
      title: "TO THE MOON",
      tag: "Moon Shot",
      emoji: "🚀",
      fx: "rocket",
      svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="stk_rkt" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ffffff"/>
            <stop offset="50%" stop-color="#38bdf8"/>
            <stop offset="100%" stop-color="#0369a1"/>
          </linearGradient>
        </defs>
        <polygon points="18,22 20,27 25,28 21,32 22,37 18,34 14,37 15,32 11,28 16,27" fill="#fde047"/>
        <polygon points="82,34 83,38 87,39 84,42 85,46 82,44 79,46 80,42 77,39 81,38" fill="#fde047"/>
        <g transform="translate(50,50) rotate(-45) translate(-50,-50)">
          <path d="M42 74 Q50 96 50 98 Q50 96 58 74 Z" fill="#f97316"/>
          <path d="M45 74 Q50 88 50 90 Q50 88 55 74 Z" fill="#fde047"/>
          <path d="M34 58 L24 72 L42 70 Z" fill="#ef4444"/>
          <path d="M66 58 L76 72 L58 70 Z" fill="#ef4444"/>
          <path d="M38 72 L38 42 Q38 18 50 14 Q62 18 62 42 L62 72 Z" fill="url(#stk_rkt)" stroke="#0f172a" stroke-width="2"/>
          <path d="M40 32 Q50 14 50 14 Q50 14 60 32 Z" fill="#ef4444"/>
          <circle cx="50" cy="46" r="9" fill="#0f172a" stroke="#ffffff" stroke-width="2"/>
          <circle cx="47" cy="45" r="2.5" fill="#38bdf8"/>
          <circle cx="53" cy="45" r="2.5" fill="#38bdf8"/>
        </g>
      </svg>`,
    },
    bot_rip: {
      id: "bot_rip",
      title: "WASTED",
      tag: "Matrix Skull",
      emoji: "💀",
      fx: "blast",
      svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="stk_matrix" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#4ade80"/>
            <stop offset="100%" stop-color="#15803d"/>
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="40" fill="rgba(34, 197, 94, 0.12)" stroke="#22c55e" stroke-width="2" stroke-dasharray="4 4"/>
        <path d="M26 44 C26 26 74 26 74 44 C74 54 68 60 62 64 L62 76 L38 76 L38 64 C32 60 26 54 26 44 Z" fill="#0f172a" stroke="url(#stk_matrix)" stroke-width="3"/>
        <path d="M24 34 L14 22 L28 26 Z" fill="#22c55e"/>
        <path d="M76 34 L86 22 L72 26 Z" fill="#22c55e"/>
        <line x1="36" y1="42" x2="44" y2="50" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/>
        <line x1="44" y1="42" x2="36" y2="50" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/>
        <line x1="56" y1="42" x2="64" y2="50" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/>
        <line x1="64" y1="42" x2="56" y2="50" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/>
        <polygon points="50,56 46,62 54,62" fill="#22c55e"/>
        <rect x="42" y="68" width="4" height="6" fill="#4ade80"/>
        <rect x="48" y="68" width="4" height="6" fill="#4ade80"/>
        <rect x="54" y="68" width="4" height="6" fill="#4ade80"/>
        <rect x="30" y="80" width="40" height="15" rx="4" fill="#15803d" stroke="#4ade80" stroke-width="1.5"/>
        <text x="50" y="91" font-size="9" font-weight="900" fill="#ffffff" text-anchor="middle" font-family="sans-serif">R.I.P</text>
      </svg>`,
    },
    bot_boom: {
      id: "bot_boom",
      title: "KA-POW!",
      tag: "Dynamite",
      emoji: "💣",
      fx: "blast",
      svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="stk_bomb" cx="40%" cy="40%" r="60%">
            <stop offset="0%" stop-color="#475569"/>
            <stop offset="60%" stop-color="#1e293b"/>
            <stop offset="100%" stop-color="#090d16"/>
          </radialGradient>
        </defs>
        <polygon points="50,4 53,14 62,8 58,18 68,16 61,24 72,25 62,31 72,37 60,39" fill="#fde047"/>
        <circle cx="68" cy="18" r="4" fill="#ef4444"/>
        <path d="M50 34 Q56 22 66 18" stroke="#ca8a04" stroke-width="3" fill="none" stroke-linecap="round"/>
        <rect x="42" y="32" width="16" height="7" rx="2" fill="#94a3b8" stroke="#0f172a" stroke-width="1.5"/>
        <circle cx="50" cy="62" r="30" fill="url(#stk_bomb)" stroke="#ef4444" stroke-width="3"/>
        <rect x="36" y="52" width="10" height="8" rx="2" fill="#f59e0b"/>
        <rect x="54" y="52" width="10" height="8" rx="2" fill="#f59e0b"/>
        <path d="M38 72 Q50 64 62 72" stroke="#ef4444" stroke-width="3" stroke-linecap="round" fill="none"/>
        <ellipse cx="38" cy="48" rx="6" ry="3" fill="rgba(255,255,255,0.4)" transform="rotate(-30 38 48)"/>
      </svg>`,
    },
    bot_cry: {
      id: "bot_cry",
      title: "CRY MORE",
      tag: "Salt Rain",
      emoji: "😭",
      fx: "rain",
      premium: true,
      svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="38" fill="#0f172a" stroke="#38bdf8" stroke-width="3"/>
        <path d="M32 38 Q38 33 44 38" stroke="#e2e8f0" stroke-width="3" fill="none" stroke-linecap="round"/>
        <path d="M56 38 Q62 33 68 38" stroke="#e2e8f0" stroke-width="3" fill="none" stroke-linecap="round"/>
        <path d="M34 44 L34 80 M42 44 L42 82" stroke="#38bdf8" stroke-width="5" stroke-linecap="round" opacity="0.85"/>
        <path d="M58 44 L58 82 M66 44 L66 80" stroke="#38bdf8" stroke-width="5" stroke-linecap="round" opacity="0.85"/>
        <ellipse cx="50" cy="64" rx="11" ry="8" fill="#ef4444" stroke="#fff" stroke-width="1.5"/>
      </svg>`,
    },
    bot_clown: {
      id: "bot_clown",
      title: "NICE TRY",
      tag: "Clown Taunt",
      emoji: "🤡",
      fx: "blast",
      premium: true,
      svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <circle cx="22" cy="42" r="12" fill="#a855f7"/>
        <circle cx="78" cy="42" r="12" fill="#a855f7"/>
        <circle cx="50" cy="52" r="34" fill="#fef9c3" stroke="#f59e0b" stroke-width="3"/>
        <circle cx="38" cy="42" r="5" fill="#0f172a"/>
        <circle cx="62" cy="42" r="5" fill="#0f172a"/>
        <circle cx="50" cy="54" r="9" fill="#ef4444"/>
        <path d="M32 66 Q50 80 68 66" stroke="#ef4444" stroke-width="4" fill="none" stroke-linecap="round"/>
      </svg>`,
    },
    bot_sleep: {
      id: "bot_sleep",
      title: "TOO EASY",
      tag: "Wake Up!",
      emoji: "😴",
      fx: "float",
      premium: false,
      svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <rect x="20" y="24" width="60" height="54" rx="18" fill="#1e293b" stroke="#818cf8" stroke-width="3"/>
        <path d="M32 48 Q38 54 44 48" stroke="#94a3b8" stroke-width="3" fill="none" stroke-linecap="round"/>
        <path d="M56 48 Q62 54 68 48" stroke="#94a3b8" stroke-width="3" fill="none" stroke-linecap="round"/>
        <circle cx="50" cy="64" r="5" fill="#818cf8"/>
        <text x="68" y="24" font-size="14" font-weight="900" fill="#38bdf8" font-family="sans-serif">Z</text>
        <text x="78" y="16" font-size="11" font-weight="900" fill="#a855f7" font-family="sans-serif">z</text>
      </svg>`,
    },
    bot_mindblown: {
      id: "bot_mindblown",
      title: "MIND BLOWN",
      tag: "Galaxy Brain",
      emoji: "🤯",
      fx: "blast",
      premium: true,
      svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <path d="M22 44 Q50 4 78 44 Q72 22 50 28 Q28 22 22 44 Z" fill="#f97316"/>
        <circle cx="30" cy="20" r="5" fill="#fde047"/>
        <circle cx="70" cy="20" r="5" fill="#fde047"/>
        <circle cx="50" cy="12" r="6" fill="#ef4444"/>
        <circle cx="50" cy="60" r="30" fill="#0f172a" stroke="#f59e0b" stroke-width="3"/>
        <circle cx="39" cy="54" r="5" fill="#38bdf8"/>
        <circle cx="61" cy="54" r="5" fill="#38bdf8"/>
        <ellipse cx="50" cy="72" rx="8" ry="6" fill="#ef4444"/>
      </svg>`,
    },
    bot_toxic: {
      id: "bot_toxic",
      title: "EZ CLAP",
      tag: "Smirk Taunt",
      emoji: "😈",
      fx: "float",
      premium: true,
      svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <path d="M26 30 L18 14 L38 24 Z" fill="#a855f7"/>
        <path d="M74 30 L82 14 L62 24 Z" fill="#a855f7"/>
        <circle cx="50" cy="54" r="34" fill="#3b0764" stroke="#c084fc" stroke-width="3"/>
        <path d="M33 44 L45 48 L35 52 Z" fill="#fde047"/>
        <path d="M67 44 L55 48 L65 52 Z" fill="#fde047"/>
        <path d="M34 65 Q50 77 66 63" stroke="#e879f9" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      </svg>`,
    },
    bot_respect: {
      id: "bot_respect",
      pack: "originals",
      title: "RESPECT",
      tag: "GG Love",
      emoji: "💖",
      fx: "float",
      premium: false,
      svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <path d="M50 86 C20 66 12 42 26 26 C36 16 48 24 50 32 C52 24 64 16 74 26 C88 42 80 66 50 86 Z" fill="#ec4899" stroke="#fbcfe8" stroke-width="3"/>
        <rect x="34" y="42" width="32" height="18" rx="6" fill="#0f172a"/>
        <circle cx="43" cy="51" r="3" fill="#67e8f9"/>
        <circle cx="57" cy="51" r="3" fill="#67e8f9"/>
      </svg>`,
    },
    bot_shh: {
      id: "bot_shh",
      pack: "taunts",
      title: "SHHH!",
      tag: "Silence!",
      emoji: "🤫",
      fx: "float",
      premium: true,
      svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="36" fill="#1e293b" stroke="#f59e0b" stroke-width="3"/>
        <circle cx="38" cy="40" r="4.5" fill="#fde047"/>
        <circle cx="62" cy="40" r="4.5" fill="#fde047"/>
        <rect x="46" y="48" width="8" height="28" rx="4" fill="#38bdf8" stroke="#0f172a" stroke-width="1.5"/>
        <path d="M38 62 L62 62" stroke="#f59e0b" stroke-width="3" stroke-linecap="round"/>
      </svg>`,
    },
    bot_bye: {
      id: "bot_bye",
      pack: "taunts",
      title: "BYE BYE!",
      tag: "Knockout",
      emoji: "👋",
      fx: "rocket",
      premium: false,
      svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="38" fill="rgba(239, 68, 68, 0.16)" stroke="#ef4444" stroke-width="2.5" stroke-dasharray="5 3"/>
        <path d="M35 66 L30 34 C30 28 38 28 38 34 L40 48 L42 24 C42 18 50 18 50 24 L50 48 L54 24 C54 18 62 18 62 24 L60 48 L66 32 C68 27 75 30 73 35 L64 68 C60 78 40 78 35 66 Z" fill="#fde047" stroke="#78350f" stroke-width="2"/>
      </svg>`,
    },
    bot_checkmate: {
      id: "bot_checkmate",
      pack: "arena",
      title: "CHECKMATE",
      tag: "Royal Win",
      emoji: "♟️",
      fx: "blast",
      premium: true,
      svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="38" fill="#0f172a" stroke="#fde047" stroke-width="3"/>
        <path d="M46 16 L54 16 L54 24 L62 24 L62 30 L54 30 L54 36 L46 36 L46 30 L38 30 L38 24 L46 24 Z" fill="#fde047"/>
        <path d="M30 42 L38 68 L62 68 L70 42 L58 50 L50 38 L42 50 Z" fill="#38bdf8" stroke="#ffffff" stroke-width="2"/>
        <rect x="30" y="72" width="40" height="10" rx="4" fill="#fde047"/>
      </svg>`,
    },
    bot_bigbrain: {
      id: "bot_bigbrain",
      pack: "arena",
      title: "200 IQ",
      tag: "Big Brain",
      emoji: "🧠",
      fx: "float",
      premium: true,
      svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="38" fill="#1e1b4b" stroke="#c084fc" stroke-width="3"/>
        <path d="M32 54 C24 54 24 38 34 36 C34 26 48 24 50 32 C52 24 66 26 66 36 C76 38 76 54 68 54 C72 64 58 72 50 66 C42 72 28 64 32 54 Z" fill="#f472b6" stroke="#fbcfe8" stroke-width="2"/>
        <path d="M50 32 L50 66" stroke="#831843" stroke-width="2"/>
        <polygon points="50,10 53,18 61,18 55,22 57,30 50,25 43,30 45,22 39,18 47,18" fill="#fde047"/>
      </svg>`,
    },
    bot_clock: {
      id: "bot_clock",
      pack: "arena",
      title: "HURRY UP!",
      tag: "Time Low",
      emoji: "⏳",
      fx: "blast",
      premium: false,
      svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="36" fill="#0f172a" stroke="#ef4444" stroke-width="3"/>
        <rect x="32" y="22" width="36" height="6" rx="3" fill="#94a3b8"/>
        <rect x="32" y="72" width="36" height="6" rx="3" fill="#94a3b8"/>
        <path d="M36 28 L64 28 L52 50 L64 72 L36 72 L48 50 Z" fill="#38bdf8" stroke="#e0f2fe" stroke-width="2"/>
        <path d="M40 68 L60 68 L50 54 Z" fill="#fde047"/>
      </svg>`,
    },
    bot_sniper: {
      id: "bot_sniper",
      pack: "arena",
      title: "BULLSEYE",
      tag: "Precision",
      emoji: "🎯",
      fx: "rocket",
      premium: true,
      svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="36" fill="#ffffff" stroke="#ef4444" stroke-width="6"/>
        <circle cx="50" cy="50" r="22" fill="#ffffff" stroke="#ef4444" stroke-width="6"/>
        <circle cx="50" cy="50" r="9" fill="#ef4444"/>
        <line x1="50" y1="50" x2="82" y2="18" stroke="#38bdf8" stroke-width="4" stroke-linecap="round"/>
        <polygon points="82,18 72,18 82,28" fill="#38bdf8"/>
      </svg>`,
    },
    bot_sweat: {
      id: "bot_sweat",
      pack: "arena",
      title: "CLOSE CALL!",
      tag: "Sweating",
      emoji: "💦",
      fx: "rain",
      premium: false,
      svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="54" r="32" fill="#0f172a" stroke="#38bdf8" stroke-width="3"/>
        <circle cx="38" cy="48" r="4" fill="#fff"/>
        <circle cx="62" cy="48" r="4" fill="#fff"/>
        <path d="M36 66 Q50 58 64 66" stroke="#38bdf8" stroke-width="3" fill="none" stroke-linecap="round"/>
        <path d="M74 18 Q84 34 74 42 Q64 34 74 18 Z" fill="#38bdf8"/>
        <path d="M24 26 Q32 38 24 44 Q16 38 24 26 Z" fill="#7dd3fc"/>
      </svg>`,
    },
    bot_jackpot: {
      id: "bot_jackpot",
      pack: "party",
      title: "JACKPOT!",
      tag: "777 Coins",
      emoji: "🎰",
      fx: "rain",
      premium: true,
      svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <rect x="14" y="24" width="72" height="52" rx="12" fill="#78350f" stroke="#fde047" stroke-width="3"/>
        <rect x="20" y="34" width="18" height="32" rx="4" fill="#fff"/>
        <rect x="41" y="34" width="18" height="32" rx="4" fill="#fff"/>
        <rect x="62" y="34" width="18" height="32" rx="4" fill="#fff"/>
        <text x="29" y="57" font-size="20" font-weight="900" fill="#ef4444" text-anchor="middle" font-family="sans-serif">7</text>
        <text x="50" y="57" font-size="20" font-weight="900" fill="#ef4444" text-anchor="middle" font-family="sans-serif">7</text>
        <text x="71" y="57" font-size="20" font-weight="900" fill="#ef4444" text-anchor="middle" font-family="sans-serif">7</text>
      </svg>`,
    },
    bot_mvp: {
      id: "bot_mvp",
      pack: "party",
      title: "MVP",
      tag: "Champion",
      emoji: "🏆",
      fx: "rain",
      premium: false,
      svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <path d="M26 22 L74 22 L66 56 Q50 68 34 56 Z" fill="#eab308" stroke="#fef08a" stroke-width="2.5"/>
        <path d="M26 28 Q14 28 16 42 Q18 50 28 48" fill="none" stroke="#eab308" stroke-width="4"/>
        <path d="M74 28 Q86 28 84 42 Q82 50 72 48" fill="none" stroke="#eab308" stroke-width="4"/>
        <rect x="44" y="60" width="12" height="14" fill="#ca8a04"/>
        <rect x="32" y="74" width="36" height="10" rx="4" fill="#eab308"/>
        <text x="50" y="45" font-size="13" font-weight="900" fill="#78350f" text-anchor="middle" font-family="sans-serif">MVP</text>
      </svg>`,
    },
    bot_party: {
      id: "bot_party",
      pack: "party",
      title: "LET'S GO!",
      tag: "Hype Fiesta",
      emoji: "🎉",
      fx: "rain",
      premium: false,
      svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <path d="M22 78 L42 28 L72 58 Z" fill="#f59e0b" stroke="#fde047" stroke-width="2.5"/>
        <circle cx="68" cy="24" r="6" fill="#ec4899"/>
        <circle cx="82" cy="40" r="5" fill="#38bdf8"/>
        <circle cx="52" cy="18" r="5" fill="#4ade80"/>
        <path d="M58 34 Q74 20 84 26" stroke="#c084fc" stroke-width="4" fill="none" stroke-linecap="round"/>
      </svg>`,
    },
    bot_thunder: {
      id: "bot_thunder",
      pack: "party",
      title: "SHOCKED!",
      tag: "Thunder",
      emoji: "⚡",
      fx: "blast",
      premium: true,
      svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="38" fill="#0f172a" stroke="#38bdf8" stroke-width="3"/>
        <polygon points="56,14 28,54 48,54 42,86 74,44 52,44" fill="#fde047" stroke="#f59e0b" stroke-width="2"/>
      </svg>`,
    },
    bot_cool: {
      id: "bot_cool",
      pack: "party",
      title: "DEAL WITH IT",
      tag: "Cyber Shades",
      emoji: "😎",
      fx: "float",
      premium: false,
      svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="36" fill="#eab308" stroke="#fef08a" stroke-width="3"/>
        <rect x="22" y="36" width="24" height="14" rx="3" fill="#0f172a"/>
        <rect x="54" y="36" width="24" height="14" rx="3" fill="#0f172a"/>
        <line x1="46" y1="42" x2="54" y2="42" stroke="#0f172a" stroke-width="4"/>
        <line x1="26" y1="40" x2="34" y2="40" stroke="#38bdf8" stroke-width="2"/>
        <line x1="58" y1="40" x2="66" y2="40" stroke="#38bdf8" stroke-width="2"/>
        <path d="M36 66 Q52 74 66 62" stroke="#0f172a" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      </svg>`,
    },
    bot_goat: {
      id: "bot_goat",
      pack: "party",
      title: "G.O.A.T.",
      tag: "Legend",
      emoji: "🐐",
      fx: "rain",
      premium: true,
      svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="38" fill="#1e293b" stroke="#fde047" stroke-width="3"/>
        <path d="M34 32 Q24 14 18 24" stroke="#cbd5e1" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M66 32 Q76 14 82 24" stroke="#cbd5e1" stroke-width="5" fill="none" stroke-linecap="round"/>
        <rect x="34" y="34" width="32" height="32" rx="10" fill="#f8fafc"/>
        <circle cx="43" cy="46" r="3" fill="#0f172a"/>
        <circle cx="57" cy="46" r="3" fill="#0f172a"/>
        <path d="M46 66 L50 78 L54 66 Z" fill="#94a3b8"/>
        <text x="50" y="92" font-size="9" font-weight="900" fill="#fde047" text-anchor="middle" font-family="sans-serif">GOAT</text>
      </svg>`,
    },
  };

  const STICKER_PACK_MAP = {
    bot_gg: "originals",
    bot_fire: "originals",
    bot_rocket: "originals",
    bot_rip: "originals",
    bot_boom: "originals",
    bot_respect: "originals",
    bot_cry: "taunts",
    bot_clown: "taunts",
    bot_sleep: "taunts",
    bot_toxic: "taunts",
    bot_mindblown: "arena",
  };

  function getStickerSubscriptionStatus() {
    if (localStorage.getItem("minigame_sticker_premium") === "true") {
      return { active: true, isPremium: true, daysLeft: 999, label: "💎 Premium Active" };
    }
    let start = parseInt(localStorage.getItem("minigame_sticker_trial_start") || "0", 10);
    if (!start) {
      start = Date.now();
      localStorage.setItem("minigame_sticker_trial_start", String(start));
    }
    const elapsedDays = Math.floor((Date.now() - start) / 86400000);
    const daysLeft = Math.max(0, 7 - elapsedDays);
    if (daysLeft > 0) {
      return { active: true, isPremium: false, daysLeft, label: `✨ ${daysLeft}d Free Trial` };
    }
    return { active: false, isPremium: false, daysLeft: 0, label: "🔒 Trial Ended" };
  }

  async function unlockPremiumStickers() {
    const fp = state.featurePricing || { sticker_premium_stars: 1, sticker_premium_coins: 500 };
    const starCost = fp.sticker_premium_stars || 1;
    const coinCost = fp.sticker_premium_coins ?? 500;

    const useStars = confirm(
      `💎 Unlock All Premium Stickers & VIP Features permanently for just ${starCost} ⭐ Star?\n\n(Click OK to pay ${starCost} ⭐ Star, or Cancel to use ${coinCost} 🪙 Coins)`
    );

    if (useStars) {
      try {
        const res = await fetch("/api/stars/create-invoice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pack_id: "pack_sticker_premium",
            init_data: tg?.initData || "",
            guest_id: state.userId || "guest",
          }),
        });
        const data = await res.json();
        if (res.ok && data.invoice_link && tg?.openInvoice && !data.mock) {
          tg.openInvoice(data.invoice_link, (status) => {
            if (status === "paid") {
              activatePremiumStickersLocal();
            }
          });
          return true;
        }
        // Mock/dev or web browser instant 1-star promo unlock
        if (res.ok) {
          activatePremiumStickersLocal();
          return true;
        }
      } catch (_) {}
    }

    const curCoins = parseInt(localStorage.getItem("flipster_coins") || "1250", 10);
    if (curCoins < coinCost) {
      alert(`⚠️ Need ${coinCost} Coins (or ${starCost} ⭐ Star) to unlock Premium Stickers!`);
      return false;
    }
    if (!confirm(`💎 Unlock all Premium Stickers permanently for ${coinCost} Coins?`)) return false;
    const nextCoins = curCoins - coinCost;
    localStorage.setItem("flipster_coins", String(nextCoins));
    const coinValEl = document.getElementById("coinVal");
    if (coinValEl) coinValEl.textContent = nextCoins.toLocaleString();
    activatePremiumStickersLocal();
    return true;
  }

  function activatePremiumStickersLocal() {
    localStorage.setItem("minigame_sticker_premium", "true");
    if (state.profile) renderProfileSummary(state.profile);
    initStickerPicker();
    triggerMagicalScreenReaction({ type: "reaction", emoji: "💎", fx: "rain", senderName: "Premium Unlocked", isSelf: true });
  }

  function triggerMagicalScreenReaction({ type, emoji, sticker_id, fx, senderName, isSelf }) {
    const overlay = document.getElementById("screenReactionOverlay");
    if (!overlay) return;

    const sticker = sticker_id && MINIGAME_STICKERS[sticker_id] ? MINIGAME_STICKERS[sticker_id] : null;
    const resolvedFx = fx || (sticker ? sticker.fx : "float");
    const displayEmoji = emoji || (sticker ? sticker.emoji : "🔥");
    const titleText = sticker ? sticker.title : displayEmoji;

    // 1. Top Reaction Announcement Toast Pill
    const toast = document.getElementById("reactionToastPill");
    if (toast) {
      const fromWho = isSelf ? "You" : (senderName || "Opponent");
      toast.innerHTML = `
        <span class="rtp-icon">${sticker ? sticker.emoji : displayEmoji}</span>
        <span class="rtp-text"><strong>${escapeHtml(fromWho)}</strong> sent ${escapeHtml(titleText)}!</span>
      `;
      toast.classList.remove("hidden");
      toast.classList.add("show");
      if (toast._timer) clearTimeout(toast._timer);
      toast._timer = setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.classList.add("hidden"), 300);
      }, 2200);
    }

    // 2. Telegram Haptics
    try {
      if (resolvedFx === "blast") {
        tg?.HapticFeedback?.impactOccurred("heavy");
      } else {
        tg?.HapticFeedback?.impactOccurred("medium");
      }
    } catch (_) {}

    // 3. Screen-Shake effect if blast
    if (resolvedFx === "blast") {
      const shakeTarget = document.getElementById("view-battle") || document.getElementById("view-player") || document.body;
      shakeTarget.classList.remove("screen-reaction-shaking");
      void shakeTarget.offsetWidth;
      shakeTarget.classList.add("screen-reaction-shaking");
      setTimeout(() => shakeTarget.classList.remove("screen-reaction-shaking"), 400);
    }

    // 4. Viewport size
    const w = window.innerWidth || document.documentElement.clientWidth;
    const h = window.innerHeight || document.documentElement.clientHeight;

    if (resolvedFx === "rocket") {
      spawnRocketCruiseEffect(overlay, sticker, displayEmoji, w, h);
    } else if (resolvedFx === "blast") {
      spawnBlastExplosionEffect(overlay, sticker, displayEmoji, w, h);
    } else if (resolvedFx === "rain") {
      spawnGoldRainEffect(overlay, sticker, displayEmoji, w, h);
    } else {
      spawnFloatSkySurgeEffect(overlay, sticker, displayEmoji, w, h);
    }
  }

  function spawnFloatSkySurgeEffect(overlay, sticker, emoji, w, h) {
    const hero = document.createElement("div");
    hero.className = "magical-particle";
    if (sticker) {
      hero.innerHTML = sticker.svg;
      hero.classList.add("magical-hero-svg");
      hero.style.width = "130px";
      hero.style.height = "130px";
    } else {
      hero.textContent = emoji || "🔥";
      hero.classList.add("magical-hero-emoji");
      hero.style.fontSize = "88px";
    }

    const startX = w * (0.35 + Math.random() * 0.3);
    const startY = h * 0.82;
    hero.style.left = `${startX}px`;
    hero.style.top = `${startY}px`;
    overlay.appendChild(hero);

    const companions = [];
    const compCount = 12;
    const miniPool = [emoji || "🔥", "✨", "✦", "★", "💖", "⚡"];
    for (let i = 0; i < compCount; i++) {
      const comp = document.createElement("div");
      comp.className = "magical-particle";
      comp.textContent = miniPool[i % miniPool.length];
      comp.style.fontSize = `${20 + Math.random() * 26}px`;
      const cx = w * (0.1 + Math.random() * 0.8);
      const cy = h * (0.7 + Math.random() * 0.25);
      comp.style.left = `${cx}px`;
      comp.style.top = `${cy}px`;
      overlay.appendChild(comp);
      companions.push({
        el: comp,
        x: cx,
        y: cy,
        vy: 3 + Math.random() * 5,
        freq: 2 + Math.random() * 3,
        phase: Math.random() * Math.PI * 2,
        amp: 15 + Math.random() * 35,
        rot: 0,
        rotSpeed: (Math.random() - 0.5) * 8,
      });
    }

    const startTime = performance.now();
    const duration = 2400;

    function frame(now) {
      const elapsed = now - startTime;
      const p = elapsed / duration;
      if (p >= 1) {
        hero.remove();
        companions.forEach((c) => c.el.remove());
        return;
      }

      // Hero movement
      const heroY = startY - p * (h * 0.88);
      const heroX = startX + Math.sin(p * 9) * 45;
      const heroScale = p < 0.2 ? (0.2 + (p / 0.2) * 1.1) : (1.3 - (p - 0.2) * 0.4);
      const heroOpacity = p > 0.75 ? Math.max(0, 1 - (p - 0.75) / 0.25) : 1;
      const heroRot = Math.sin(p * 8) * 14;
      hero.style.transform = `translate3d(${heroX - startX}px, ${heroY - startY}px, 0) scale(${heroScale}) rotate(${heroRot}deg)`;
      hero.style.opacity = heroOpacity;

      // Companion particles
      companions.forEach((c) => {
        c.y -= c.vy;
        const curX = c.x + Math.sin(p * 12 + c.phase) * c.amp;
        c.rot += c.rotSpeed;
        const compOpacity = p > 0.7 ? Math.max(0, 1 - (p - 0.7) / 0.3) : 1;
        c.el.style.transform = `translate3d(${curX - c.x}px, ${c.y - (h * 0.7)}px, 0) rotate(${c.rot}deg)`;
        c.el.style.opacity = compOpacity;
      });

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function spawnRocketCruiseEffect(overlay, sticker, emoji, w, h) {
    const rocket = document.createElement("div");
    rocket.className = "magical-particle";
    if (sticker) {
      rocket.innerHTML = sticker.svg;
      rocket.classList.add("magical-hero-svg");
      rocket.style.width = "120px";
      rocket.style.height = "120px";
    } else {
      rocket.textContent = "🚀";
      rocket.style.fontSize = "82px";
    }

    const startX = -80;
    const startY = h * 0.88;
    const targetX = w + 120;
    const targetY = h * 0.08;
    rocket.style.left = "0px";
    rocket.style.top = "0px";
    overlay.appendChild(rocket);

    const startTime = performance.now();
    const duration = 1600;
    let lastSmokeTime = 0;
    const trailParticles = [];

    function frame(now) {
      const elapsed = now - startTime;
      const p = elapsed / duration;
      if (p >= 1) {
        rocket.remove();
        trailParticles.forEach((t) => t.el.remove());
        return;
      }

      // Supersonic trajectory
      const curX = startX + p * (targetX - startX);
      const curY = startY + p * (targetY - startY) + Math.sin(p * 10) * 18;
      const angle = Math.atan2(targetY - startY, targetX - startX) * (180 / Math.PI) + 90;

      rocket.style.transform = `translate3d(${curX}px, ${curY}px, 0) rotate(${angle}deg) scale(${1 + Math.sin(p * Math.PI) * 0.3})`;
      rocket.style.opacity = p > 0.9 ? (1 - (p - 0.9) / 0.1) : 1;

      // Spawn trailing fiery smoke every 40ms
      if (now - lastSmokeTime > 40 && p < 0.9) {
        lastSmokeTime = now;
        const smoke = document.createElement("div");
        smoke.className = "magical-particle";
        smoke.textContent = Math.random() > 0.4 ? "✨" : "🔥";
        smoke.style.fontSize = `${16 + Math.random() * 20}px`;
        smoke.style.left = `${curX + (Math.random() - 0.5) * 20}px`;
        smoke.style.top = `${curY + (Math.random() - 0.5) * 20}px`;
        overlay.appendChild(smoke);
        trailParticles.push({
          el: smoke,
          birth: now,
          life: 600,
          vx: (Math.random() - 0.5) * 3,
          vy: 2 + Math.random() * 3,
          curX: curX,
          curY: curY,
        });
      }

      // Update trailing particles
      for (let i = trailParticles.length - 1; i >= 0; i--) {
        const tp = trailParticles[i];
        const age = now - tp.birth;
        if (age >= tp.life) {
          tp.el.remove();
          trailParticles.splice(i, 1);
        } else {
          const frac = age / tp.life;
          tp.curX += tp.vx;
          tp.curY += tp.vy;
          tp.el.style.transform = `translate3d(${tp.curX}px, ${tp.curY}px, 0) scale(${1 - frac * 0.5})`;
          tp.el.style.opacity = 1 - frac;
        }
      }

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function spawnBlastExplosionEffect(overlay, sticker, emoji, w, h) {
    const center = document.createElement("div");
    center.className = "magical-particle";
    if (sticker) {
      center.innerHTML = sticker.svg;
      center.classList.add("magical-hero-svg");
      center.style.width = "140px";
      center.style.height = "140px";
    } else {
      center.textContent = emoji || "💣";
      center.style.fontSize = "94px";
    }
    const cx = w * 0.5;
    const cy = h * 0.46;
    center.style.left = `${cx}px`;
    center.style.top = `${cy}px`;
    overlay.appendChild(center);

    const startTime = performance.now();
    const pulseDuration = 380;
    const shards = [];

    function frame(now) {
      const elapsed = now - startTime;
      if (elapsed < pulseDuration) {
        // Warning Pulse
        const p = elapsed / pulseDuration;
        const scale = 0.3 + p * 1.1;
        center.style.transform = `translate3d(-50%, -50%, 0) scale(${scale})`;
        center.style.opacity = Math.min(1, p * 3);
        requestAnimationFrame(frame);
      } else if (shards.length === 0) {
        // DETONATE!
        center.style.display = "none";
        const shardCount = 28;
        const shardPool = ["🔥", "💥", "⚡", "✨", "💣", "✦", "★"];
        for (let i = 0; i < shardCount; i++) {
          const s = document.createElement("div");
          s.className = "magical-particle";
          s.textContent = shardPool[i % shardPool.length];
          s.style.fontSize = `${20 + Math.random() * 26}px`;
          s.style.left = `${cx}px`;
          s.style.top = `${cy}px`;
          overlay.appendChild(s);
          const rad = (i / shardCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
          const speed = 10 + Math.random() * 18;
          shards.push({
            el: s,
            x: 0,
            y: 0,
            vx: Math.cos(rad) * speed,
            vy: Math.sin(rad) * speed,
            rot: 0,
            rotSpeed: (Math.random() - 0.5) * 20,
          });
        }
        requestAnimationFrame(frame);
      } else {
        // Shards flying outward
        const p = (elapsed - pulseDuration) / 1400;
        if (p >= 1) {
          center.remove();
          shards.forEach((s) => s.el.remove());
          return;
        }

        shards.forEach((s) => {
          s.x += s.vx;
          s.y += s.vy;
          s.vx *= 0.94;
          s.vy = s.vy * 0.94 + 0.3; // gravity
          s.rot += s.rotSpeed;
          s.el.style.transform = `translate3d(calc(-50% + ${s.x}px), calc(-50% + ${s.y}px), 0) scale(${1 - p * 0.4}) rotate(${s.rot}deg)`;
          s.el.style.opacity = Math.max(0, 1 - p * 1.2);
        });

        requestAnimationFrame(frame);
      }
    }
    requestAnimationFrame(frame);
  }

  function spawnGoldRainEffect(overlay, sticker, emoji, w, h) {
    const rainCount = 28;
    const pool = ["👑", "🪙", "🏆", "💎", "🎉", "✨", "★"];
    const drops = [];

    for (let i = 0; i < rainCount; i++) {
      const drop = document.createElement("div");
      drop.className = "magical-particle";
      if (sticker && i === 0) {
        drop.innerHTML = sticker.svg;
        drop.style.width = "90px";
        drop.style.height = "90px";
      } else {
        drop.textContent = pool[i % pool.length];
        drop.style.fontSize = `${24 + Math.random() * 26}px`;
      }
      const x = w * (0.05 + Math.random() * 0.9);
      const y = -60 - Math.random() * 120;
      drop.style.left = `${x}px`;
      drop.style.top = "0px";
      overlay.appendChild(drop);
      drops.push({
        el: drop,
        x: x,
        y: y,
        vy: 4 + Math.random() * 6,
        rot: 0,
        rotSpeed: (Math.random() - 0.5) * 10,
        swayAmp: 10 + Math.random() * 25,
        phase: Math.random() * Math.PI * 2,
      });
    }

    const startTime = performance.now();
    const duration = 2600;

    function frame(now) {
      const elapsed = now - startTime;
      const p = elapsed / duration;
      if (p >= 1) {
        drops.forEach((d) => d.el.remove());
        return;
      }

      drops.forEach((d) => {
        d.y += d.vy;
        d.rot += d.rotSpeed;
        const sway = Math.sin(p * 10 + d.phase) * d.swayAmp;
        const curY = d.y;
        const dropOpacity = curY > h * 0.85 ? Math.max(0, 1 - (curY - h * 0.85) / (h * 0.15)) : 1;
        d.el.style.transform = `translate3d(${sway}px, ${curY}px, 0) rotate(${d.rot}deg)`;
        d.el.style.opacity = dropOpacity;
      });

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function sendMatchReaction(emoji, fx = "float") {
    triggerMagicalScreenReaction({
      type: "reaction",
      emoji: emoji,
      fx: fx,
      senderName: state.userName || "You",
      isSelf: true,
    });

    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      sendWs({
        type: "reaction",
        emoji: emoji,
        fx: fx,
      });
    }

    document.getElementById("inGameReactionDock")?.classList.add("hidden");
  }

  function sendMatchSticker(stickerId) {
    const s = MINIGAME_STICKERS[stickerId];
    if (!s) return;

    const sub = getStickerSubscriptionStatus();
    if (s.premium && !sub.active) {
      unlockPremiumStickers();
      return;
    }

    triggerMagicalScreenReaction({
      type: "sticker",
      sticker_id: stickerId,
      fx: s.fx,
      senderName: state.userName || "You",
      isSelf: true,
    });

    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      sendWs({
        type: "sticker",
        sticker_id: stickerId,
        fx: s.fx,
      });
    }

    toggleStickersTray(false);
    document.getElementById("inGameReactionDock")?.classList.add("hidden");
  }

  let activeStickerPack = "all";

  function initStickerPicker(packFilter) {
    if (packFilter) activeStickerPack = packFilter;

    const banner = document.getElementById("stickerTrialBanner");
    const sub = getStickerSubscriptionStatus();
    if (banner) {
      banner.textContent = sub.isPremium ? "💎 PREMIUM ACTIVE" : sub.active ? `${sub.label} • Upgrade 💎` : "🔒 Unlock Premium (500 🪙)";
      banner.classList.toggle("premium-active", sub.isPremium);
      if (!banner.dataset.wired) {
        banner.dataset.wired = "true";
        banner.addEventListener("click", () => {
          if (!getStickerSubscriptionStatus().isPremium) {
            unlockPremiumStickers();
          }
        });
      }
    }

    const tabsWrap = document.getElementById("stickerPackTabs");
    if (tabsWrap && !tabsWrap.dataset.wired) {
      tabsWrap.dataset.wired = "true";
      tabsWrap.querySelectorAll(".sp-tab-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          haptic("light");
          tabsWrap.querySelectorAll(".sp-tab-btn").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          initStickerPicker(btn.dataset.pack || "all");
        });
      });
    }

    const grid = document.getElementById("stickerCardsGrid");
    if (!grid) return;
    grid.innerHTML = "";

    Object.values(MINIGAME_STICKERS).forEach((s) => {
      const sPack = s.pack || STICKER_PACK_MAP[s.id] || "originals";
      if (activeStickerPack !== "all" && sPack !== activeStickerPack) return;

      const card = document.createElement("div");
      card.className = "sticker-card";
      const premBadge = s.premium ? `<span class="sticker-premium-tag">${sub.active ? "PRO ✨" : "🔒 PRO"}</span>` : "";
      card.innerHTML = `
        ${premBadge}
        <div class="sticker-art-wrap">${s.svg}</div>
        <div class="sticker-lbl">${s.title}</div>
        <div class="sticker-tag">${s.tag}</div>
      `;
      card.addEventListener("click", () => {
        sendMatchSticker(s.id);
      });
      grid.appendChild(card);
    });
  }

  let unreadChatCount = 0;
  let isChatOpen = false;

  function appendMatchChatMessage(msg) {
    const list = document.getElementById("chatMessagesList");
    if (!list) return;
    const isSelf = msg.sender_id === state.userId;
    const row = document.createElement("div");
    row.className = `chat-msg-row ${isSelf ? "self" : "opp"}`;
    const name = escapeHtml(msg.sender_name || (isSelf ? "You" : "Opponent"));

    if (msg.type === "sticker" && msg.sticker_id && MINIGAME_STICKERS[msg.sticker_id]) {
      const s = MINIGAME_STICKERS[msg.sticker_id];
      row.innerHTML = `
        <div class="chat-msg-author">${name}</div>
        <div class="chat-sticker-bubble" data-sticker="${s.id}" title="Tap to re-blast!">
          <div class="csb-art">${s.svg}</div>
          <div class="csb-caption">${s.title}</div>
        </div>
      `;
      row.querySelector(".chat-sticker-bubble")?.addEventListener("click", () => {
        triggerMagicalScreenReaction({
          type: "sticker",
          sticker_id: s.id,
          fx: s.fx,
          senderName: isSelf ? "You" : name,
          isSelf: isSelf,
        });
      });
    } else if (msg.type === "reaction" && msg.emoji) {
      row.innerHTML = `
        <div class="chat-msg-author">${name}</div>
        <div class="chat-reaction-bubble" title="Tap to re-blast!">${msg.emoji}</div>
      `;
      row.querySelector(".chat-reaction-bubble")?.addEventListener("click", () => {
        triggerMagicalScreenReaction({
          type: "reaction",
          emoji: msg.emoji,
          fx: msg.fx || "float",
          senderName: isSelf ? "You" : name,
          isSelf: isSelf,
        });
      });
    } else {
      const text = escapeHtml(msg.text || "");
      row.innerHTML = `
        <div class="chat-msg-author">${name}</div>
        <div class="chat-bubble">${text}</div>
      `;
    }

    list.appendChild(row);
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
      initStickerPicker();
      const inp = document.getElementById("chatInputText");
      if (inp) inp.focus();
    } else {
      modal.classList.add("hidden");
      document.getElementById("stickerPickerTray")?.classList.add("hidden");
      document.getElementById("btnToggleStickerTray")?.classList.remove("active");
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

    try {
      const roomBadge = document.getElementById("roomBadge");
      if (roomBadge) roomBadge.textContent = `Room: ${room.room_id}`;
      const specPill = document.getElementById("specPill");
      if (specPill) specPill.textContent = `👁️ ${room.spectators || 0}`;
      updatePlayerCards();
    } catch (err) {
      console.warn("Error updating player cards/header in match:", err);
    }

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
    if (!container) return;
    if (!isArcade) {
      container.innerHTML = "";
    }

    try {
      if (room.game_type === "chess") renderChessBoard(container, room, selfP, myTurn);
      else if (room.game_type === "othello") renderOthelloBoard(container, room, myTurn);
      else if (room.game_type === "connect4") renderConnect4Board(container, room, myTurn);
      else if (isArcade) renderArcadeArenaGame(container, room, selfP);
      else renderTicTacToeBoard(container, room, myTurn);
    } catch (err) {
      console.error("Error rendering arena game board:", err);
    }
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

  // =========================================================
  // INTERACTIVE PROFILE & 3D HOLOGRAPHIC MEMBER CARD WIRING
  // =========================================================
  const profileHoloCard = document.getElementById("profileHoloCard");
  if (profileHoloCard) {
    attachHoloTilt(profileHoloCard);
    profileHoloCard.addEventListener("click", () => {
      haptic("light");
      profileHoloCard.classList.toggle("is-flipped");
    });
  }

  document.getElementById("btnFlipHoloCard")?.addEventListener("click", () => {
    haptic("light");
    profileHoloCard?.classList.toggle("is-flipped");
  });

  document.getElementById("btnCycleCardSkin")?.addEventListener("click", () => {
    haptic("medium");
    const cur = localStorage.getItem("minigame_card_skin") || "crown";
    const nextIdx = (HOLO_SKINS.indexOf(cur) + 1) % HOLO_SKINS.length;
    applyHoloCardSkin(HOLO_SKINS[nextIdx]);
  });

  document.getElementById("btnClaimDailyBonus")?.addEventListener("click", () => {
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem("minigame_daily_claim_date") === today) return;
    haptic("heavy");
    const curCoins = parseInt(localStorage.getItem("flipster_coins") || "1250", 10);
    const nextCoins = curCoins + 250;
    localStorage.setItem("flipster_coins", String(nextCoins));
    localStorage.setItem("minigame_daily_claim_date", today);

    const coinValEl = document.getElementById("coinVal");
    if (coinValEl) coinValEl.textContent = nextCoins.toLocaleString();
    const profWalletCoins = document.getElementById("profWalletCoins");
    if (profWalletCoins) profWalletCoins.textContent = `🪙 ${nextCoins.toLocaleString()}`;
    const bCoins = document.getElementById("holoBackCoins");
    if (bCoins) bCoins.textContent = nextCoins.toLocaleString();

    updateDailyBonusBtnState();
    triggerMagicalScreenReaction({
      type: "reaction",
      emoji: "🪙",
      fx: "rain",
      senderName: "Daily Bonus (+250)",
      isSelf: true,
    });
  });

  document.getElementById("btnProfOpenShop")?.addEventListener("click", () => {
    haptic("light");
    if (typeof openStarsShop === "function") openStarsShop();
  });

  // Profile Tabs
  document.querySelectorAll(".prof-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      haptic("light");
      const target = btn.dataset.proftab;
      document.querySelectorAll(".prof-tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".prof-tab-pane").forEach((pane) => pane.classList.add("hidden"));
      const activePane = document.getElementById(`profPane-${target}`);
      if (activePane) activePane.classList.remove("hidden");
      if (target === "members") {
        loadMembersHoloCards();
      }
    });
  });

  document.getElementById("btnRefreshMembers")?.addEventListener("click", () => {
    haptic("light");
    loadMembersHoloCards();
  });

  // Share Member Card
  document.getElementById("btnShareMemberCard")?.addEventListener("click", async () => {
    haptic("medium");
    const name = state.profile?.display_name || state.userName || "Player";
    const elo = Math.round(state.profile?.elo || 1200);
    const botUser = state.botUsername || "minigame_bot";
    const shareUrl = `https://t.me/${botUser}?startapp=ref_${state.userId}`;
    const shareText = `⚡ Check out my Ghost Plays Member Card! ${name} • ${elo} ELO. Challenge me in the Arena!`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Ghost Plays Member Card", text: shareText, url: shareUrl });
        return;
      } catch (_) {}
    }
    try {
      await navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
      alert("✅ Member Card & Arena invite link copied!");
    } catch (_) {
      alert(`${shareText}\n${shareUrl}`);
    }
  });

  // Edit Profile Modal
  let selectedPresetAvatar = localStorage.getItem("minigame_prof_avatar") || "/static/bot_avatar.jpg";
  document.getElementById("btnEditProfile")?.addEventListener("click", () => {
    haptic("light");
    const modal = document.getElementById("modalEditProfile");
    if (!modal) return;
    const nameInp = document.getElementById("editProfNameInput");
    const bioInp = document.getElementById("editProfBioInput");
    const skinSel = document.getElementById("editProfSkinSelect");
    if (nameInp) nameInp.value = state.profile?.display_name || state.userName || "Player";
    if (bioInp) bioInp.value = localStorage.getItem("minigame_prof_bio") || "Ready to dominate the arena!";
    if (skinSel) skinSel.value = localStorage.getItem("minigame_card_skin") || "crown";

    document.querySelectorAll(".av-preset-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.av === selectedPresetAvatar);
    });
    modal.classList.remove("hidden");
  });

  document.getElementById("btnCloseEditProfile")?.addEventListener("click", () => {
    document.getElementById("modalEditProfile")?.classList.add("hidden");
  });

  document.querySelectorAll(".av-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".av-preset-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedPresetAvatar = btn.dataset.av || "/static/bot_avatar.jpg";
    });
  });

  document.getElementById("formEditProfile")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const newName = document.getElementById("editProfNameInput")?.value.trim() || "Player";
    const newBio = document.getElementById("editProfBioInput")?.value.trim() || "Ready to dominate the arena!";
    const newSkin = document.getElementById("editProfSkinSelect")?.value || "crown";

    localStorage.setItem("minigame_prof_bio", newBio);
    localStorage.setItem("minigame_prof_avatar", selectedPresetAvatar);
    localStorage.setItem("guest_name", newName);
    applyHoloCardSkin(newSkin);
    state.userName = newName;

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          init_data: tg?.initData || "",
          guest_id: state.userId,
          guest_name: newName,
        }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.profile) renderProfileSummary(d.profile);
      } else if (state.profile) {
        state.profile.display_name = newName;
        renderProfileSummary(state.profile);
      }
    } catch (_) {
      if (state.profile) {
        state.profile.display_name = newName;
        renderProfileSummary(state.profile);
      }
    }

    document.getElementById("modalEditProfile")?.classList.add("hidden");
    haptic("medium");
  });

  // Preferences Toggles
  function initPrefToggles() {
    const sfxBtn = document.getElementById("btnPrefSfx");
    const hapBtn = document.getElementById("btnPrefHaptics");
    const sfxOn = localStorage.getItem("minigame_pref_sfx") !== "off";
    const hapOn = localStorage.getItem("minigame_pref_haptics") !== "off";

    if (sfxBtn) {
      sfxBtn.classList.toggle("active", sfxOn);
      sfxBtn.textContent = sfxOn ? "ON" : "OFF";
      sfxBtn.addEventListener("click", () => {
        const next = !sfxBtn.classList.contains("active");
        sfxBtn.classList.toggle("active", next);
        sfxBtn.textContent = next ? "ON" : "OFF";
        localStorage.setItem("minigame_pref_sfx", next ? "on" : "off");
      });
    }
    if (hapBtn) {
      hapBtn.classList.toggle("active", hapOn);
      hapBtn.textContent = hapOn ? "ON" : "OFF";
      hapBtn.addEventListener("click", () => {
        const next = !hapBtn.classList.contains("active");
        hapBtn.classList.toggle("active", next);
        hapBtn.textContent = next ? "ON" : "OFF";
        localStorage.setItem("minigame_pref_haptics", next ? "on" : "off");
      });
    }
  }
  initPrefToggles();

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

  // Telegram Premium Stickers & Floating Reactions Wiring
  const btnToggleStickerTray = document.getElementById("btnToggleStickerTray");
  const stickerPickerTray = document.getElementById("stickerPickerTray");
  const btnInputSticker = document.getElementById("btnInputSticker");
  const inGameReactionDock = document.getElementById("inGameReactionDock");

  function toggleStickersTray(force) {
    if (!stickerPickerTray) return;
    const quickPills = document.querySelector(".quick-chat-pills");
    const shouldOpen = force !== undefined ? force : stickerPickerTray.classList.contains("hidden");
    if (shouldOpen) {
      initStickerPicker();
      stickerPickerTray.classList.remove("hidden");
      btnToggleStickerTray?.classList.add("active");
      if (quickPills) quickPills.classList.add("hidden");
    } else {
      stickerPickerTray.classList.add("hidden");
      btnToggleStickerTray?.classList.remove("active");
      if (quickPills) quickPills.classList.remove("hidden");
    }
  }

  btnToggleStickerTray?.addEventListener("click", () => {
    haptic("light");
    toggleStickersTray();
  });
  btnInputSticker?.addEventListener("click", () => {
    haptic("light");
    toggleStickersTray();
  });

  // Reaction buttons inside chat drawer
  document.querySelectorAll(".btn-screen-react").forEach((btn) => {
    btn.addEventListener("click", () => {
      const emoji = btn.dataset.emoji || "🔥";
      const fx = btn.dataset.fx || "float";
      haptic("medium");
      sendMatchReaction(emoji, fx);
    });
  });

  // In-game quick floating reaction dock triggers
  function toggleReactionDock(force) {
    if (!inGameReactionDock) return;
    const isHidden = inGameReactionDock.classList.contains("hidden");
    const open = force !== undefined ? force : isHidden;
    if (open) {
      inGameReactionDock.classList.remove("hidden");
    } else {
      inGameReactionDock.classList.add("hidden");
    }
  }

  document.getElementById("btnQuickReaction")?.addEventListener("click", (e) => {
    e.stopPropagation();
    haptic("light");
    toggleReactionDock();
  });

  document.getElementById("btnPlayerReact")?.addEventListener("click", (e) => {
    e.stopPropagation();
    haptic("light");
    toggleReactionDock();
  });

  document.querySelectorAll(".dock-react-btn:not(.dock-btn-more)").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const emoji = btn.dataset.emoji || "🔥";
      const fx = btn.dataset.fx || "float";
      haptic("medium");
      sendMatchReaction(emoji, fx);
    });
  });

  document.getElementById("btnDockMoreStickers")?.addEventListener("click", (e) => {
    e.stopPropagation();
    haptic("light");
    toggleReactionDock(false);
    toggleMatchChat(true);
    toggleStickersTray(true);
  });

  // Close reaction dock when tapping outside
  document.addEventListener("click", (e) => {
    if (inGameReactionDock && !inGameReactionDock.classList.contains("hidden")) {
      if (!inGameReactionDock.contains(e.target) && !e.target.closest("#btnQuickReaction") && !e.target.closest("#btnPlayerReact")) {
        inGameReactionDock.classList.add("hidden");
      }
    }
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

  // Cute Telegram-Style Animated Character Stickers for Gaming Sections
  const CUTE_ANIMATED_CHARACTERS = {
    arcade: `<svg class="cute-char-sticker" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <line x1="32" y1="6" x2="32" y2="15" stroke="#38bdf8" stroke-width="3" stroke-linecap="round"/>
      <circle class="ccs-float" cx="32" cy="6" r="4" fill="#fde047"/>
      <rect x="14" y="15" width="36" height="32" rx="14" fill="#6366f1" stroke="#a5b4fc" stroke-width="2.5"/>
      <ellipse class="ccs-wiggle" cx="11" cy="31" rx="4" ry="7" fill="#818cf8"/>
      <ellipse class="ccs-wiggle" cx="53" cy="31" rx="4" ry="7" fill="#818cf8"/>
      <rect x="20" y="23" width="24" height="13" rx="6.5" fill="#0f172a"/>
      <circle class="ccs-blink" cx="27" cy="29.5" r="3" fill="#38bdf8"/>
      <circle class="ccs-blink" cx="37" cy="29.5" r="3" fill="#38bdf8"/>
      <path d="M27 41 Q32 45 37 41" stroke="#ffffff" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      <rect x="21" y="47" width="7" height="7" rx="3.5" fill="#4f46e5"/>
      <rect x="36" y="47" width="7" height="7" rx="3.5" fill="#4f46e5"/>
    </svg>`,
    puzzle: `<svg class="cute-char-sticker" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 26 L12 10 L26 18 Z" fill="#10b981"/>
      <path d="M48 26 L52 10 L38 18 Z" fill="#10b981"/>
      <rect x="13" y="18" width="38" height="34" rx="17" fill="#34d399" stroke="#a7f3d0" stroke-width="2.5"/>
      <circle cx="21" cy="37" r="3.5" fill="#fb7185" opacity="0.6"/>
      <circle cx="43" cy="37" r="3.5" fill="#fb7185" opacity="0.6"/>
      <circle class="ccs-blink" cx="24" cy="32" r="3.5" fill="#0f172a"/>
      <circle cx="25" cy="30.8" r="1.2" fill="#ffffff"/>
      <circle class="ccs-blink" cx="40" cy="32" r="3.5" fill="#0f172a"/>
      <circle cx="41" cy="30.8" r="1.2" fill="#ffffff"/>
      <path d="M28 38 Q32 42 36 38" stroke="#0f172a" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      <circle class="ccs-float" cx="52" cy="14" r="3" fill="#fde047"/>
    </svg>`,
    sport: `<svg class="cute-char-sticker" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <ellipse class="ccs-wiggle" cx="12" cy="34" rx="5" ry="8" fill="#f59e0b"/>
      <ellipse class="ccs-wiggle" cx="52" cy="34" rx="5" ry="8" fill="#f59e0b"/>
      <circle cx="32" cy="34" r="19" fill="#fde047" stroke="#f59e0b" stroke-width="2.5"/>
      <path d="M27 15 Q32 7 37 15" fill="#ef4444"/>
      <circle class="ccs-blink" cx="25" cy="31" r="3.2" fill="#0f172a"/>
      <circle cx="26" cy="30" r="1" fill="#ffffff"/>
      <circle class="ccs-blink" cx="39" cy="31" r="3.2" fill="#0f172a"/>
      <circle cx="40" cy="30" r="1" fill="#ffffff"/>
      <polygon points="28,36 36,36 32,42" fill="#f97316"/>
      <circle cx="20" cy="37" r="3" fill="#fb7185" opacity="0.55"/>
      <circle cx="44" cy="37" r="3" fill="#fb7185" opacity="0.55"/>
    </svg>`,
    cards: `<svg class="cute-char-sticker" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <path class="ccs-float" d="M16 48 L16 28 C16 14 48 14 48 28 L48 48 L41 43 L36 49 L32 43 L28 49 L23 43 Z" fill="#f8fafc" stroke="#c084fc" stroke-width="2.5"/>
      <polygon points="22,16 32,6 42,16" fill="#a855f7" stroke="#e9d5ff" stroke-width="1.5"/>
      <circle class="ccs-blink" cx="25" cy="30" r="3" fill="#0f172a"/>
      <circle class="ccs-blink" cx="39" cy="30" r="3" fill="#0f172a"/>
      <circle cx="21" cy="35" r="2.8" fill="#f472b6" opacity="0.65"/>
      <circle cx="43" cy="35" r="2.8" fill="#f472b6" opacity="0.65"/>
      <path d="M29 36 Q32 40 35 36" stroke="#0f172a" stroke-width="2" fill="none" stroke-linecap="round"/>
    </svg>`,
    rocket: `<svg class="cute-char-sticker" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <circle cx="17" cy="20" r="6" fill="#0f172a"/>
      <circle cx="47" cy="20" r="6" fill="#0f172a"/>
      <circle cx="32" cy="35" r="18" fill="#ffffff" stroke="#38bdf8" stroke-width="2.5"/>
      <ellipse cx="24" cy="33" rx="5" ry="6" fill="#0f172a" transform="rotate(-15 24 33)"/>
      <ellipse cx="40" cy="33" rx="5" ry="6" fill="#0f172a" transform="rotate(15 40 33)"/>
      <circle class="ccs-blink" cx="25" cy="32" r="2" fill="#ffffff"/>
      <circle class="ccs-blink" cx="39" cy="32" r="2" fill="#ffffff"/>
      <ellipse cx="32" cy="39" rx="3" ry="2" fill="#0f172a"/>
      <circle class="ccs-float" cx="51" cy="46" r="4" fill="#fde047"/>
    </svg>`,
    knight: `<svg class="cute-char-sticker" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <path class="ccs-wiggle" d="M28 12 Q32 4 38 12 L34 18 Z" fill="#ef4444"/>
      <rect x="16" y="16" width="32" height="32" rx="14" fill="#94a3b8" stroke="#e2e8f0" stroke-width="2.5"/>
      <rect x="21" y="25" width="22" height="12" rx="5" fill="#0f172a"/>
      <circle class="ccs-blink" cx="27" cy="31" r="2.6" fill="#fde047"/>
      <circle class="ccs-blink" cx="37" cy="31" r="2.6" fill="#fde047"/>
      <rect x="24" y="48" width="16" height="8" rx="4" fill="#38bdf8"/>
    </svg>`,
    gamer: `<svg class="cute-char-sticker" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 32 C14 14 50 14 50 32" fill="none" stroke="#38bdf8" stroke-width="4" stroke-linecap="round"/>
      <rect x="10" y="27" width="7" height="14" rx="3.5" fill="#0284c7"/>
      <rect x="47" y="27" width="7" height="14" rx="3.5" fill="#0284c7"/>
      <circle cx="32" cy="36" r="16" fill="#f97316" stroke="#fed7aa" stroke-width="2"/>
      <circle class="ccs-blink" cx="26" cy="34" r="2.8" fill="#0f172a"/>
      <circle class="ccs-blink" cx="38" cy="34" r="2.8" fill="#0f172a"/>
      <ellipse cx="32" cy="39" rx="3.5" ry="2.2" fill="#0f172a"/>
      <path d="M28 43 Q32 46 36 43" stroke="#ffffff" stroke-width="2" fill="none" stroke-linecap="round"/>
    </svg>`,
  };

  function getCuteCharacterSvg(key) {
    return CUTE_ANIMATED_CHARACTERS[key] || CUTE_ANIMATED_CHARACTERS.gamer;
  }

  function initCuteCategoryStickers() {
    document.querySelectorAll(".cute-char-slot").forEach((slot) => {
      const k = slot.dataset.char || "gamer";
      slot.innerHTML = getCuteCharacterSvg(k);
    });
  }
  initCuteCategoryStickers();

  function renderFilteredGames() {
    const el = document.getElementById("customGamesGrid");
    if (!el) return;
    const cat = state.gameFilterCat || "all";
    const q = (state.gameSearchQuery || "").toLowerCase().trim();

    // Toggle instant search focus mode on Home view so results appear right under search box
    const homeView = document.getElementById("view-home");
    if (homeView) {
      homeView.classList.toggle("is-searching", q.length > 0);
    }

    const uniqueGames = getUniqueGamesList();
    const countEl = document.getElementById("totalGamesCount");
    if (countEl) countEl.textContent = `${uniqueGames.length}`;

    // If searching or filtering by a specific category, display standard filtered grid
    if (q || cat !== "all") {
      const filtered = uniqueGames.filter((g) => {
        const gCat = classifyGameCategory(g);
        const matchCat = q ? true : (cat === "all" || gCat === cat);
        const matchQ = !q || g.title.toLowerCase().includes(q) || (g.description && g.description.toLowerCase().includes(q)) || gCat.toLowerCase().includes(q);
        return matchCat && matchQ;
      });

      if (!filtered.length) {
        el.className = "custom-games-grid";
        el.innerHTML = `
          <div class="empty-games-hint">
            No games found matching "${escapeHtml(q)}". Try another search keyword!
          </div>`;
        return;
      }

      el.className = "custom-games-grid";
      el.innerHTML = filtered.map(makeGameCardHtml).join("");
    } else {
      // Categorized sections in Arcade view ("different sections of games instead of one list")
      const sections = [
        {
          char: "rocket",
          theme: "featured",
          title: "Featured & High-Stakes",
          matcher: (g) => /aviator|flipster|space race|sheep fight/i.test(g.title)
        },
        {
          char: "arcade",
          theme: "action",
          title: "Action & Endless Adventures",
          matcher: (g) => /chintu|mario|dino|space invaders|snake/i.test(g.title)
        },
        {
          char: "knight",
          theme: "pvp",
          title: "PvP & Reflex Battles",
          matcher: (g) => /knife|fruit|whack|pong|typer/i.test(g.title)
        },
        {
          char: "sport",
          theme: "tower",
          title: "Tower & Block Physics",
          matcher: (g) => /tower|helix|tetris|breakout|pinball/i.test(g.title)
        },
        {
          char: "puzzle",
          theme: "puzzle",
          title: "Puzzle & Brain Challenge",
          matcher: (g) => /roll the ball|2048|wordle|sudoku|puzzle|flood|memory|simon/i.test(g.title)
        },
        {
          char: "cards",
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
                    <span class="cute-char-slot">${getCuteCharacterSvg(sec.char)}</span>
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
                  <span class="cute-char-slot">${getCuteCharacterSvg("gamer")}</span>
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
      setTimeout(initBubbleText, 40);

      setHeroSlide(0);
      startHeroAutoSlide();
    } catch (e) {
      console.warn("Failed to load promo banners:", e);
    }
  }

  // Initial load of sliding window banners, ads & subscribe gate
  loadHeroCarouselBanners();
  loadShopConfig();
  loadPublicAds();
  setTimeout(checkForceSubscribeGate, 700);

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
      if (data.feature_pricing) {
        state.featurePricing = data.feature_pricing;
      }
      if (Array.isArray(data.star_packs)) {
        data.star_packs.forEach((sp) => {
          const btn = document.querySelector(`.btn-buy-stars[data-pack="${sp.id}"]`);
          if (btn) {
            btn.dataset.stars = sp.stars;
            btn.dataset.coins = sp.coins;
            btn.innerHTML = `<span class="star-sym">⭐</span> ${sp.stars} Star${sp.stars > 1 ? "s" : ""}`;
          }
        });
      }
      if (Array.isArray(data.inr_packs)) {
        data.inr_packs.forEach((ip) => {
          const pill = document.querySelector(`.upi-pack-pill[data-pack="${ip.id}"]`);
          if (pill) {
            pill.dataset.inr = ip.price_inr;
            pill.dataset.coins = ip.coins;
            pill.textContent = `₹${ip.price_inr} • ${(ip.coins / 1000).toFixed(0)}k`;
          }
        });
      }
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

  function getAdminSecret() {
    const fromAds = document.getElementById("adsAdminSecret")?.value.trim();
    const fromPricing = document.getElementById("pricingAdminSecret")?.value.trim();
    const fromBanner = document.getElementById("bannerAdminSecret")?.value.trim();
    const fromGame = document.getElementById("inputAdminSecret")?.value.trim();
    const fromStorage = localStorage.getItem("minigame_admin_secret")?.trim();
    return fromAds || fromPricing || fromBanner || fromGame || fromStorage || "";
  }

  function syncAdminSecret(val) {
    if (!val) return;
    localStorage.setItem("minigame_admin_secret", val);
    ["adsAdminSecret", "pricingAdminSecret", "bannerAdminSecret", "inputAdminSecret"].forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.value !== val) el.value = val;
    });
  }

  function initAdminSecretInputs() {
    const saved = localStorage.getItem("minigame_admin_secret") || "";
    ["adsAdminSecret", "pricingAdminSecret", "bannerAdminSecret", "inputAdminSecret"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        if (saved && !el.value) el.value = saved;
        if (!el.dataset.secWired) {
          el.dataset.secWired = "true";
          el.addEventListener("input", () => syncAdminSecret(el.value.trim()));
        }
      }
    });
  }

  async function loadAdminGamesList() {
    initAdminSecretInputs();
    const listEl = document.getElementById("adminGamesList");
    const res = await fetch("/api/custom-games");
    const data = await res.json();
    if (!data.games.length) {
      listEl.innerHTML = `<div style="font-size: 0.8rem; color: var(--muted);">No games added yet.</div>`;
      return;
    }
    const secret = getAdminSecret();
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

  // Studio tabs switching (Add/Manage Games vs Sliding Window Banners vs Pricing vs Ads & Tasks)
  const tabBtnAddGame = document.getElementById("tabBtnAddGame");
  const tabBtnPromoBanners = document.getElementById("tabBtnPromoBanners");
  const tabBtnPricing = document.getElementById("tabBtnPricing");
  const tabBtnAdsTasks = document.getElementById("tabBtnAdsTasks");
  const tabContentAddGame = document.getElementById("tabContentAddGame");
  const tabContentPromoBanners = document.getElementById("tabContentPromoBanners");
  const tabContentPricing = document.getElementById("tabContentPricing");
  const tabContentAdsTasks = document.getElementById("tabContentAdsTasks");

  function switchStudioTab(activeTab) {
    [tabBtnAddGame, tabBtnPromoBanners, tabBtnPricing, tabBtnAdsTasks].forEach((b) => b?.classList.remove("active"));
    [tabContentAddGame, tabContentPromoBanners, tabContentPricing, tabContentAdsTasks].forEach((c) => c?.classList.add("hidden"));
    if (activeTab === "games") {
      tabBtnAddGame?.classList.add("active");
      tabContentAddGame?.classList.remove("hidden");
    } else if (activeTab === "banners") {
      tabBtnPromoBanners?.classList.add("active");
      tabContentPromoBanners?.classList.remove("hidden");
      loadAdminBannersList();
      populateBannerGameSelect();
    } else if (activeTab === "pricing") {
      tabBtnPricing?.classList.add("active");
      tabContentPricing?.classList.remove("hidden");
      loadAdminPricing();
    } else if (activeTab === "adsTasks") {
      tabBtnAdsTasks?.classList.add("active");
      tabContentAdsTasks?.classList.remove("hidden");
      loadAdminAdsAndTasks();
    }
  }

  tabBtnAddGame?.addEventListener("click", () => switchStudioTab("games"));
  tabBtnPromoBanners?.addEventListener("click", () => switchStudioTab("banners"));
  tabBtnPricing?.addEventListener("click", () => switchStudioTab("pricing"));
  tabBtnAdsTasks?.addEventListener("click", () => switchStudioTab("adsTasks"));

  // =========================================================
  // ADMIN ADS & SUBSCRIBE TASKS ENGINE + PUBLIC 30s VIDEO ADS
  // =========================================================
  async function loadAdminAdsAndTasks() {
    initAdminSecretInputs();
    const secret = getAdminSecret();
    const adsList = document.getElementById("adminAdsList");
    const tasksList = document.getElementById("adminTasksList");
    const btnAdsMaster = document.getElementById("btnToggleAdsMaster");
    const btnSubMaster = document.getElementById("btnToggleForceSubMaster");

    try {
      const [adsRes, tasksRes] = await Promise.all([
        fetch(`/api/admin/ads?user_id=${encodeURIComponent(state.userId)}&admin_secret=${encodeURIComponent(secret)}`),
        fetch(`/api/admin/tasks?user_id=${encodeURIComponent(state.userId)}&admin_secret=${encodeURIComponent(secret)}`),
      ]);

      if (adsRes.ok) {
        const d = await adsRes.json();
        if (btnAdsMaster) {
          btnAdsMaster.classList.toggle("active", Boolean(d.ads_enabled));
          btnAdsMaster.textContent = d.ads_enabled ? "ON" : "OFF";
        }
        if (adsList) {
          if (!d.ads.length) {
            adsList.innerHTML = '<div style="color:var(--muted);font-size:0.82rem;">No advertisements created yet.</div>';
          } else {
            adsList.innerHTML = "";
            d.ads.forEach((ad) => {
              const row = document.createElement("div");
              row.className = "admin-banner-card";
              row.innerHTML = `
                <div class="admin-banner-info">
                  <div class="admin-banner-title">${escapeHtml(ad.title)} <span style="font-size:0.7rem;color:#38bdf8;">(${escapeHtml(ad.ad_type)})</span></div>
                  <div class="admin-banner-meta">Reward: +${ad.reward_coins} 🪙 • Skip: ${ad.skip_seconds}s • ${ad.is_active ? "🟢 Active" : "⏸️ Paused"}</div>
                </div>
                <div class="admin-banner-actions">
                  <button type="button" class="btn small toggle-ad-btn">${ad.is_active ? "⏸️" : "▶️"}</button>
                  <button type="button" class="btn small danger del-ad-btn">🗑️</button>
                </div>
              `;
              row.querySelector(".toggle-ad-btn")?.addEventListener("click", async () => {
                await fetch(`/api/admin/ads/${ad.id}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ ...ad, is_active: ad.is_active ? 0 : 1, user_id: state.userId, admin_secret: getAdminSecret() }),
                });
                loadAdminAdsAndTasks();
                loadPublicAds();
              });
              row.querySelector(".del-ad-btn")?.addEventListener("click", async () => {
                if (!confirm("Delete this ad?")) return;
                await fetch(`/api/admin/ads/${ad.id}?user_id=${encodeURIComponent(state.userId)}&admin_secret=${encodeURIComponent(getAdminSecret())}`, { method: "DELETE" });
                loadAdminAdsAndTasks();
                loadPublicAds();
              });
              adsList.appendChild(row);
            });
          }
        }
      } else if (adsList) {
        adsList.innerHTML = '<div style="color:#ef4444;font-size:0.82rem;">Enter Admin Secret to manage ads.</div>';
      }

      if (tasksRes.ok) {
        const td = await tasksRes.json();
        if (btnSubMaster) {
          btnSubMaster.classList.toggle("active", Boolean(td.force_sub_enabled));
          btnSubMaster.textContent = td.force_sub_enabled ? "ON" : "OFF";
        }
        if (tasksList) {
          if (!td.tasks.length) {
            tasksList.innerHTML = '<div style="color:var(--muted);font-size:0.82rem;">No channels/groups configured yet.</div>';
          } else {
            tasksList.innerHTML = "";
            td.tasks.forEach((t) => {
              const row = document.createElement("div");
              row.className = "admin-banner-card";
              row.innerHTML = `
                <div class="admin-banner-info">
                  <div class="admin-banner-title">${t.kind === "group" ? "👥" : "📢"} ${escapeHtml(t.title)}</div>
                  <div class="admin-banner-meta">${escapeHtml(t.chat_id)} • +${t.reward_coins} 🪙 • ${t.is_required ? "🔒 Required" : "🎁 Optional"}</div>
                </div>
                <div class="admin-banner-actions">
                  <button type="button" class="btn small danger del-task-btn">🗑️</button>
                </div>
              `;
              row.querySelector(".del-task-btn")?.addEventListener("click", async () => {
                if (!confirm("Remove this channel/group task?")) return;
                await fetch(`/api/admin/tasks/${t.id}?user_id=${encodeURIComponent(state.userId)}&admin_secret=${encodeURIComponent(getAdminSecret())}`, { method: "DELETE" });
                loadAdminAdsAndTasks();
              });
              tasksList.appendChild(row);
            });
          }
        }
      }
    } catch (e) {
      if (adsList) adsList.innerHTML = `<div style="color:#ef4444;font-size:0.82rem;">Error: ${escapeHtml(e.message)}</div>`;
    }
  }

  document.getElementById("btnToggleAdsMaster")?.addEventListener("click", async () => {
    const btn = document.getElementById("btnToggleAdsMaster");
    const next = !btn?.classList.contains("active");
    const res = await fetch("/api/admin/ads/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next, user_id: state.userId, admin_secret: getAdminSecret() }),
    });
    if (res.ok) {
      loadAdminAdsAndTasks();
      loadPublicAds();
    } else {
      alert("Admin secret required to toggle Ads.");
    }
  });

  document.getElementById("btnToggleForceSubMaster")?.addEventListener("click", async () => {
    const btn = document.getElementById("btnToggleForceSubMaster");
    const next = !btn?.classList.contains("active");
    const res = await fetch("/api/admin/tasks/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next, user_id: state.userId, admin_secret: getAdminSecret() }),
    });
    if (res.ok) {
      loadAdminAdsAndTasks();
    } else {
      alert("Admin secret required to toggle Force Subscribe.");
    }
  });

  document.getElementById("formAddPromoAd")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      title: document.getElementById("adTitleInput")?.value.trim() || "Sponsored Offer",
      ad_type: document.getElementById("adTypeSelect")?.value || "video_reward",
      description: document.getElementById("adDescInput")?.value.trim() || "",
      media_url: document.getElementById("adMediaUrlInput")?.value.trim() || "",
      target_url: document.getElementById("adTargetUrlInput")?.value.trim() || "",
      cta_label: document.getElementById("adCtaInput")?.value.trim() || "Visit Offer",
      skip_seconds: parseInt(document.getElementById("adSkipSecInput")?.value || "30", 10) || 30,
      reward_coins: parseInt(document.getElementById("adRewardCoinsInput")?.value || "100", 10) || 100,
      is_active: 1,
      user_id: state.userId,
      admin_secret: getAdminSecret(),
    };
    const res = await fetch("/api/admin/ads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      e.target.reset();
      document.getElementById("adSkipSecInput").value = "30";
      document.getElementById("adRewardCoinsInput").value = "100";
      loadAdminAdsAndTasks();
      loadPublicAds();
      alert("✅ Advertisement published!");
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || "Failed to publish ad");
    }
  });

  document.getElementById("formAddSubscribeTask")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      title: document.getElementById("taskTitleInput")?.value.trim() || "Official Channel",
      kind: document.getElementById("taskKindSelect")?.value || "channel",
      chat_id: document.getElementById("taskChatIdInput")?.value.trim() || "",
      invite_url: document.getElementById("taskUrlInput")?.value.trim() || "",
      reward_coins: parseInt(document.getElementById("taskRewardInput")?.value || "200", 10) || 0,
      is_required: parseInt(document.getElementById("taskRequiredSelect")?.value || "1", 10),
      user_id: state.userId,
      admin_secret: getAdminSecret(),
    };
    const res = await fetch("/api/admin/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      e.target.reset();
      document.getElementById("taskRewardInput").value = "200";
      loadAdminAdsAndTasks();
      alert("✅ Channel/Group subscribe task added!");
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || "Failed to add task");
    }
  });

  // Public Website Ads & 30s Rewarded Video Player
  let publicAdsState = { ads_enabled: false, ads: [] };
  let activeVideoAdTimer = null;

  async function loadPublicAds() {
    const section = document.getElementById("homeAdsSection");
    const inlineSlot = document.getElementById("homeInlineAdSlot");
    try {
      const res = await fetch("/api/ads/config");
      if (!res.ok) return;
      const data = await res.json();
      publicAdsState = data;

      if (!data.ads_enabled) {
        section?.classList.add("hidden");
        return;
      }
      section?.classList.remove("hidden");

      const videoAds = data.ads.filter((a) => a.ad_type === "video_reward");
      const watchBar = document.getElementById("btnHomeWatchAd");
      if (watchBar) {
        const topReward = videoAds[0]?.reward_coins || 100;
        const rBadge = watchBar.querySelector(".wapb-reward");
        if (rBadge) rBadge.textContent = `+${topReward} 🪙`;
      }

      const inlineAd = data.ads.find((a) => a.ad_type === "banner_inline");
      if (inlineSlot) {
        if (inlineAd) {
          inlineSlot.classList.remove("hidden");
          inlineSlot.innerHTML = `
            <div class="hiad-left">
              <img src="${escapeHtml(inlineAd.media_url || "/static/banners/welcome_banner.jpg")}" class="hiad-img" alt="Promo" onerror="this.src='/static/banners/welcome_banner.jpg'" />
              <div style="min-width:0;">
                <div class="hiad-badge">SPONSORED OFFER</div>
                <div class="hiad-title">${escapeHtml(inlineAd.title)}</div>
                <div class="hiad-desc">${escapeHtml(inlineAd.description || "")}</div>
              </div>
            </div>
            <a href="${escapeHtml(inlineAd.target_url || "#")}" target="_blank" class="btn small primary" style="flex-shrink:0;">${escapeHtml(inlineAd.cta_label || "Open")}</a>
          `;
        } else {
          inlineSlot.classList.add("hidden");
        }
      }

      // Show Fullscreen Product Popup Ad once per session if configured
      const popupAd = data.ads.find((a) => a.ad_type === "fullscreen_popup");
      if (popupAd && !sessionStorage.getItem(`popup_shown_${popupAd.id}`)) {
        sessionStorage.setItem(`popup_shown_${popupAd.id}`, "1");
        setTimeout(() => openPopupAd(popupAd), 1800);
      }
    } catch (_) {}
  }

  function openPopupAd(ad) {
    if (!ad) return;
    const modal = document.getElementById("modalPopupAd");
    if (!modal) return;
    const img = document.getElementById("popupAdImg");
    const title = document.getElementById("popupAdTitle");
    const desc = document.getElementById("popupAdDesc");
    const cta = document.getElementById("popupAdCta");
    if (img) img.src = ad.media_url || "/static/banners/welcome_banner.jpg";
    if (title) title.textContent = ad.title || "Special Offer";
    if (desc) desc.textContent = ad.description || "Check out this sponsored promotion!";
    if (cta) {
      cta.href = ad.target_url || "#";
      cta.textContent = `🚀 ${ad.cta_label || "Visit Offer"}`;
    }
    modal.classList.remove("hidden");
  }

  document.getElementById("btnClosePopupAd")?.addEventListener("click", () => {
    document.getElementById("modalPopupAd")?.classList.add("hidden");
  });

  function openRewardedVideoAd(ad) {
    if (!publicAdsState.ads_enabled) return;
    const videoAd = ad || publicAdsState.ads.find((a) => a.ad_type === "video_reward") || {
      id: 0,
      title: "Ghost Plays Sponsored Showcase",
      description: "Watch for 30 seconds to earn free Bonus Coins!",
      media_url: "",
      target_url: "",
      cta_label: "Visit Sponsor",
      skip_seconds: 30,
      reward_coins: 100,
    };

    const modal = document.getElementById("modalRewardedVideoAd");
    const vid = document.getElementById("rvcVideoPlayer");
    const fb = document.getElementById("rvcFallbackShowcase");
    const titleEl = document.getElementById("rvcAdTitle");
    const descEl = document.getElementById("rvcAdDesc");
    const pill = document.getElementById("rvcTimerPill");
    const fill = document.getElementById("rvcProgressFill");
    const claimBtn = document.getElementById("btnRvcClaimClose");
    const ctaLink = document.getElementById("rvcCtaLink");
    if (!modal) return;

    if (titleEl) titleEl.textContent = videoAd.title || "Sponsored Video";
    if (descEl) descEl.textContent = videoAd.description || "Watch until the timer ends to claim your reward!";
    if (ctaLink) {
      if (videoAd.target_url) {
        ctaLink.href = videoAd.target_url;
        ctaLink.textContent = `🔗 ${videoAd.cta_label || "Visit Offer"}`;
        ctaLink.classList.remove("hidden");
      } else {
        ctaLink.classList.add("hidden");
      }
    }

    const isVideoUrl = /\.(mp4|webm|ogg)(\?.*)?$/i.test(videoAd.media_url || "");
    if (vid && fb) {
      if (isVideoUrl) {
        vid.src = videoAd.media_url;
        vid.style.display = "block";
        fb.style.display = "none";
        vid.play().catch(() => {});
      } else {
        vid.pause();
        vid.style.display = "none";
        fb.style.display = "block";
      }
    }

    const totalSec = Math.max(5, parseInt(videoAd.skip_seconds ?? 30, 10));
    const reward = parseInt(videoAd.reward_coins ?? 100, 10);
    let remaining = totalSec;

    if (activeVideoAdTimer) clearInterval(activeVideoAdTimer);
    if (claimBtn) {
      claimBtn.disabled = true;
      claimBtn.textContent = `⏳ Wait ${remaining}s to Claim +${reward} 🪙`;
    }
    if (pill) pill.textContent = `⏳ Skip in ${remaining}s`;
    if (fill) fill.style.width = "0%";

    modal.classList.remove("hidden");

    activeVideoAdTimer = setInterval(() => {
      remaining--;
      const pct = Math.min(100, Math.round(((totalSec - remaining) / totalSec) * 100));
      if (fill) fill.style.width = `${pct}%`;

      if (remaining <= 0) {
        clearInterval(activeVideoAdTimer);
        activeVideoAdTimer = null;
        if (pill) pill.textContent = "✅ Reward Ready!";
        if (claimBtn) {
          claimBtn.disabled = false;
          claimBtn.textContent = `✅ Skip & Claim +${reward} 🪙`;
          claimBtn.onclick = async () => {
            modal.classList.add("hidden");
            if (vid) vid.pause();
            if (videoAd.id) {
              await fetch("/api/ads/claim-reward", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ad_id: videoAd.id, user_id: state.userId, init_data: tg?.initData || "" }),
              }).catch(() => {});
            }
            const curCoins = parseInt(localStorage.getItem("flipster_coins") || "1250", 10);
            const nextCoins = curCoins + reward;
            localStorage.setItem("flipster_coins", String(nextCoins));
            const coinValEl = document.getElementById("coinVal");
            if (coinValEl) coinValEl.textContent = nextCoins.toLocaleString();
            if (state.profile) renderProfileSummary(state.profile);
            triggerMagicalScreenReaction({ type: "reaction", emoji: "🪙", fx: "rain", senderName: `Ad Reward (+${reward})`, isSelf: true });
          };
        }
      } else {
        if (pill) pill.textContent = `⏳ Skip in ${remaining}s`;
        if (claimBtn) claimBtn.textContent = `⏳ Wait ${remaining}s to Claim +${reward} 🪙`;
      }
    }, 1000);
  }

  document.getElementById("btnRvcMuteToggle")?.addEventListener("click", () => {
    const vid = document.getElementById("rvcVideoPlayer");
    const btn = document.getElementById("btnRvcMuteToggle");
    if (vid && btn) {
      vid.muted = !vid.muted;
      btn.textContent = vid.muted ? "🔇" : "🔊";
    }
  });

  document.getElementById("btnHomeWatchAd")?.addEventListener("click", () => {
    haptic("light");
    openRewardedVideoAd();
  });

  // Force Subscribe / Follow Verification Gate
  async function checkForceSubscribeGate() {
    if (state.isAdmin) return;
    try {
      const res = await fetch(`/api/tasks/status?user_id=${encodeURIComponent(state.userId || "")}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.force_sub_enabled) return;
      const pendingRequired = (data.tasks || []).filter((t) => t.is_required && !t.claimed);
      if (!pendingRequired.length) return;

      const listEl = document.getElementById("forceSubTasksList");
      if (listEl) {
        listEl.innerHTML = pendingRequired
          .map(
            (t) => `
          <div class="force-sub-row">
            <div>
              <div class="fsr-title">${t.kind === "group" ? "👥" : "📢"} ${escapeHtml(t.title)}</div>
              <div class="fsr-meta">${t.reward_coins > 0 ? `+${t.reward_coins} 🪙 Reward` : "Required"}</div>
            </div>
            <a href="${escapeHtml(t.invite_url)}" target="_blank" class="btn small primary">Join</a>
          </div>`
          )
          .join("");
      }
      document.getElementById("modalForceSubscribe")?.classList.remove("hidden");
    } catch (_) {}
  }

  document.getElementById("btnVerifyForceSub")?.addEventListener("click", async () => {
    const btn = document.getElementById("btnVerifyForceSub");
    const msgEl = document.getElementById("forceSubStatusMsg");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "⏳ Checking with Telegram...";
    }
    try {
      const res = await fetch("/api/tasks/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: state.userId || "",
          init_data: tg?.initData || "",
        }),
      });
      const data = await res.json();
      if (!data.verified) {
        if (msgEl) {
          msgEl.textContent = data.message || "❌ Not subscribed yet! Join all channels first — no reward granted.";
          msgEl.classList.remove("hidden");
        }
        haptic("heavy");
      } else {
        document.getElementById("modalForceSubscribe")?.classList.add("hidden");
        if (data.coins_added > 0) {
          const curCoins = parseInt(localStorage.getItem("flipster_coins") || "1250", 10);
          localStorage.setItem("flipster_coins", String(curCoins + data.coins_added));
          if (state.profile) renderProfileSummary(state.profile);
          triggerMagicalScreenReaction({ type: "reaction", emoji: "🪙", fx: "rain", senderName: `Verified (+${data.coins_added})`, isSelf: true });
        } else {
          alert(data.message || "✅ Subscriptions verified!");
        }
      }
    } catch (e) {
      if (msgEl) {
        msgEl.textContent = "Verification error: " + e.message;
        msgEl.classList.remove("hidden");
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "✅ I've Joined — Verify & Claim";
      }
    }
  });

  let currentAdminPricing = { star_packs: [], inr_packs: [] };

  async function loadAdminPricing() {
    initAdminSecretInputs();
    const starWrap = document.getElementById("adminStarPacksEditor");
    const inrWrap = document.getElementById("adminInrPacksEditor");
    if (!starWrap || !inrWrap) return;

    const secret = getAdminSecret();
    try {
      const res = await fetch(`/api/admin/pricing?user_id=${encodeURIComponent(state.userId)}&admin_secret=${encodeURIComponent(secret)}`);
      if (!res.ok) {
        starWrap.innerHTML = '<div style="color:#ef4444;font-size:0.8rem;">⚠️ Enter Admin Secret below to load/edit pricing.</div>';
        inrWrap.innerHTML = "";
        return;
      }
      const data = await res.json();
      currentAdminPricing = data;
      const fp = data.feature_pricing || {};
      const elS = document.getElementById("priceStickerStars");
      const elC = document.getElementById("priceStickerCoins");
      const elV = document.getElementById("priceVipStars");
      const elU = document.getElementById("priceUpiId");
      if (elS) elS.value = fp.sticker_premium_stars ?? 1;
      if (elC) elC.value = fp.sticker_premium_coins ?? 500;
      if (elV) elV.value = fp.vip_pass_stars ?? 1;
      if (elU) elU.value = data.upi_id || "patelkeshav@upi";

      starWrap.innerHTML = (data.star_packs || []).map((p, idx) => `
        <div class="admin-pack-edit-row" data-sp-idx="${idx}">
          <div class="aper-head"><span>${p.icon || "🪙"} ${escapeHtml(p.id)}</span><span>${escapeHtml(p.badge || "")}</span></div>
          <div class="aper-grid">
            <div class="aper-field"><label>Title</label><input type="text" class="sp-title" value="${escapeHtml(p.title)}" /></div>
            <div class="aper-field"><label>Stars ⭐</label><input type="number" min="1" class="sp-stars" value="${p.stars}" /></div>
            <div class="aper-field"><label>Coins 🪙</label><input type="number" min="1" class="sp-coins" value="${p.coins}" /></div>
          </div>
        </div>
      `).join("");

      inrWrap.innerHTML = (data.inr_packs || []).map((p, idx) => `
        <div class="admin-pack-edit-row" data-ip-idx="${idx}">
          <div class="aper-head"><span>${p.icon || "🪙"} ${escapeHtml(p.id)}</span><span>${escapeHtml(p.badge || "")}</span></div>
          <div class="aper-grid">
            <div class="aper-field"><label>Title</label><input type="text" class="ip-title" value="${escapeHtml(p.title)}" /></div>
            <div class="aper-field"><label>Price ₹</label><input type="number" min="1" class="ip-inr" value="${p.price_inr}" /></div>
            <div class="aper-field"><label>Coins 🪙</label><input type="number" min="1" class="ip-coins" value="${p.coins}" /></div>
          </div>
        </div>
      `).join("");
    } catch (e) {
      starWrap.innerHTML = `<div style="color:#ef4444;font-size:0.8rem;">Error: ${escapeHtml(e.message)}</div>`;
    }
  }

  document.getElementById("btnSetAllOneStar")?.addEventListener("click", () => {
    const elS = document.getElementById("priceStickerStars");
    const elV = document.getElementById("priceVipStars");
    if (elS) elS.value = "1";
    if (elV) elV.value = "1";
    document.querySelectorAll("#adminStarPacksEditor .sp-stars").forEach((inp) => {
      inp.value = "1";
    });
    haptic("medium");
  });

  document.getElementById("formAdminPricing")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    let admin_secret = getAdminSecret();
    if (!admin_secret && !state.isAdmin) {
      const prompted = prompt("🔐 Enter Admin Secret passcode to save pricing:");
      if (prompted && prompted.trim()) {
        admin_secret = prompted.trim();
        syncAdminSecret(admin_secret);
      } else {
        alert("⚠️ Admin Secret passcode is required.");
        return;
      }
    }

    const updatedStars = (currentAdminPricing.star_packs || []).map((p, idx) => {
      const row = document.querySelector(`.admin-pack-edit-row[data-sp-idx="${idx}"]`);
      return {
        ...p,
        title: row?.querySelector(".sp-title")?.value.trim() || p.title,
        stars: parseInt(row?.querySelector(".sp-stars")?.value || p.stars, 10) || 1,
        coins: parseInt(row?.querySelector(".sp-coins")?.value || p.coins, 10) || 1000,
      };
    });

    const updatedInr = (currentAdminPricing.inr_packs || []).map((p, idx) => {
      const row = document.querySelector(`.admin-pack-edit-row[data-ip-idx="${idx}"]`);
      return {
        ...p,
        title: row?.querySelector(".ip-title")?.value.trim() || p.title,
        price_inr: parseInt(row?.querySelector(".ip-inr")?.value || p.price_inr, 10) || 49,
        coins: parseInt(row?.querySelector(".ip-coins")?.value || p.coins, 10) || 5000,
      };
    });

    const payload = {
      star_packs: updatedStars,
      inr_packs: updatedInr,
      sticker_premium_stars: parseInt(document.getElementById("priceStickerStars")?.value || "1", 10) || 1,
      sticker_premium_coins: parseInt(document.getElementById("priceStickerCoins")?.value || "500", 10) || 500,
      vip_pass_stars: parseInt(document.getElementById("priceVipStars")?.value || "1", 10) || 1,
      upi_id: document.getElementById("priceUpiId")?.value.trim() || "",
      user_id: state.userId,
      admin_secret,
    };

    try {
      const res = await fetch("/api/admin/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || "Failed to save pricing");
        return;
      }
      await loadShopConfig();
      await loadAdminPricing();
      alert("✅ Pricing & 1-Star Promo updated successfully!");
    } catch (err) {
      alert("Error saving pricing: " + err.message);
    }
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

      const admin_secret = getAdminSecret();
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
    let admin_secret = getAdminSecret();

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
      loadHeroCarouselBanners();
  loadShopConfig(); // Live update home carousel with updated game logo
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

  const BANNER_SMART_SUGGESTIONS = {
    "aviator": {
      title: "AVIATOR SKY HIGH",
      theme: "slide-aviator",
      badge: "HOT 🔥",
      badge2: "x1000 CRASH",
      desc: "Multiply your coin balance before the rocket bursts into space!",
      cta: "Play Aviator Rocket",
      hooks: [
        "Multiply your coin balance before the rocket bursts into space!",
        "Cash out before the crash! High stakes multiplier thrills!",
        "Ascend to cosmic heights! Will you hold or take profits early?",
        "Daily multiplier leaderboard! Reach 100x and win giant jackpots!"
      ]
    },
    "dino": {
      title: "T-REX CYBER RUN",
      theme: "slide-speedway",
      badge: "FEATURED 🦖",
      badge2: "SPEEDWAY",
      desc: "Infinite cyberpunk hurdle runner with high-speed neon ramps!",
      cta: "Play Cyber Dino",
      hooks: [
        "Infinite cyberpunk hurdle runner with high-speed neon ramps!",
        "Sprint across neon dunes and jump blazing cyber obstacles!",
        "Survive ultra-speed velocity ramps and unlock legendary avatars!",
        "High-velocity reflex dash! How far can you outrun the grid?"
      ]
    },
    "space_invaders": {
      title: "GALAXY DEFENDER 3D",
      theme: "slide-invaders",
      badge: "ARCADE 👾",
      badge2: "BOSS RAID",
      desc: "Blast descending alien swarms and defeat colossal boss battles!",
      cta: "Play Galaxy Defender",
      hooks: [
        "Blast descending alien swarms and defeat colossal boss battles!",
        "Retro arcade 3D space shooter with laser powerups and titan bosses!",
        "Defend the galaxy against alien fleets in pulse-pounding arcade combat!",
        "Upgrade lasers and shield generators to crush the cosmic invaders!"
      ]
    },
    "tetris": {
      title: "RETRO TETRIS",
      theme: "slide-tetris",
      badge: "PUZZLE 🧩",
      badge2: "CLASSIC",
      desc: "Classic block-clearing arcade puzzle with glowing neon lines!",
      cta: "Play Retro Tetris",
      hooks: [
        "Classic block-clearing arcade puzzle with glowing neon lines!",
        "Clear multi-line Tetris combos and climb global puzzle leaderboards!",
        "Pure retro arcade perfection with glowing synthwave blocks!",
        "Fast block-dropping puzzle action to test your speed and foresight!"
      ]
    },
    "chess": {
      title: "GRANDMASTER CHESS",
      theme: "slide-gold",
      badge: "PVP DUEL ♟️",
      badge2: "RANKED ELO",
      desc: "Tactical 8x8 tournament duels with live clocks, chat, and ranked ELO!",
      cta: "Play Ranked Chess",
      hooks: [
        "Tactical 8x8 tournament duels with live clocks, chat, and ranked ELO!",
        "Challenge grandmasters worldwide in real-time rated blitz matches!",
        "Outwit your rival with tactical pins, forks, and checkmates!",
        "Climb the master tier! Prove your board supremacy in 1v1 PvP!"
      ]
    },
    "connect4": {
      title: "CONNECT 4 ROYALE",
      theme: "slide-aviator",
      badge: "4-IN-A-ROW 🔴",
      badge2: "TACTICAL",
      desc: "Drop glowing discs and outsmart your rival with 4-in-a-row connections!",
      cta: "Play Connect 4",
      hooks: [
        "Drop glowing discs and outsmart your rival with 4-in-a-row connections!",
        "Fast-paced tactical gravity duel! Block traps and claim victory!",
        "Form diagonal and horizontal lines before your opponent detects the setup!"
      ]
    },
    "othello": {
      title: "OTHELLO REVERSI",
      theme: "slide-tetris",
      badge: "STRATEGY ⚫",
      badge2: "FLIP DUEL",
      desc: "Outflank opposing discs, trap the four corners, and conquer the board!",
      cta: "Play Othello Reversi",
      hooks: [
        "Outflank opposing discs, trap the four corners, and conquer the board!",
        "A minute to learn, a lifetime to master! Flank and flip all discs!",
        "Strategic reversi showdowns with live timers and ranked ladder points!"
      ]
    },
    "tictactoe": {
      title: "XO BLITZ ARENA",
      theme: "slide-cyan",
      badge: "⚡ 5s BLITZ",
      badge2: "FAST PACED",
      desc: "Ultra-fast 3x3 tactical duels with 5-second blitz timeout forfeits!",
      cta: "Play XO Blitz",
      hooks: [
        "Ultra-fast 3x3 tactical duels with 5-second blitz timeout forfeits!",
        "No time to hesitate! 5-second turns in lightning-quick tic-tac-toe!",
        "Ranked 3x3 lightning duels! Speed and precision decide the champion!"
      ]
    },
    "knife_hit": {
      title: "KNIFE MASTER 3D",
      theme: "slide-aviator",
      badge: "TOURNAMENT 🗡️",
      badge2: "15+ LEVELS",
      desc: "MPL-style speedrun! Slice spinning targets and defeat boss logs!",
      cta: "Play Knife Master",
      hooks: [
        "MPL-style speedrun! Slice spinning targets and defeat boss logs!",
        "Throw sharp daggers into the target wheel without hitting existing blades!",
        "15+ escalating boss stages! Test your surgical timing and reflexes!"
      ]
    },
    "fruit_slice": {
      title: "FRUIT SLICE BLADE",
      theme: "slide-tetris",
      badge: "ARCADE 🍉",
      badge2: "3 LIVES",
      desc: "Swipe juicy multi-fruit combos and dodge explosive bombs in blitz mode!",
      cta: "Play Fruit Slice",
      hooks: [
        "Swipe juicy multi-fruit combos and dodge explosive bombs in blitz mode!",
        "Unleash blade strikes on flying melons, pineapples, and dragonfruits!",
        "3 minutes of slicing frenzy! Rack up multi-combos for huge scores!"
      ]
    },
    "sheep_fight": {
      title: "SHEEP FIGHT ROYALE",
      theme: "slide-cyan",
      badge: "HAGO 🐑",
      badge2: "5 LANES",
      desc: "Hago-style 5-lane sheep pushing battle! Clash horned rams to victory!",
      cta: "Play Sheep Fight",
      hooks: [
        "Hago-style 5-lane sheep pushing battle! Clash horned rams to victory!",
        "Deploy rams across 5 lanes to push your rival off the pasture!",
        "Tactical weight and speed duel! Match heavy rams against light runners!"
      ]
    },
    "virus_breaker": {
      title: "VIRUS BREAKER CANNON",
      theme: "slide-invaders",
      badge: "NEW 🔥",
      badge2: "CANNON BLAST",
      desc: "Hago-style blaster duel! Pop levitating jumping viruses with upgraded cannons!",
      cta: "Play Virus Breaker",
      hooks: [
        "Hago-style blaster duel! Pop levitating jumping viruses with upgraded cannons!",
        "Fire multi-barrel cannons at floating viral swarms before they drop!",
        "Fast-paced levitating bubble pop challenge with escalating firepower!"
      ]
    },
    "helix_jump": {
      title: "HELIX DROP 3D",
      theme: "slide-speedway",
      badge: "ADDICTIVE 🌀",
      badge2: "ENDLESS TOWER",
      desc: "Rotate the spiral helix tower and bounce through colorful sector gaps!",
      cta: "Play Helix Drop",
      hooks: [
        "Rotate the spiral helix tower and bounce through colorful sector gaps!",
        "Freefall through multiple floor stages and activate fiery booster breaks!",
        "Endless spiral tower drop! Test your coordination and fall depth!"
      ]
    },
    "plinko": {
      title: "PLINKO LUCKY DROP",
      theme: "slide-gold",
      badge: "LUCKY 🪙",
      badge2: "x100 MULTIPLIER",
      desc: "Drop lucky coins through the peg pyramid into high multiplier prize gift boxes!",
      cta: "Play Plinko Drop",
      hooks: [
        "Drop lucky coins through the peg pyramid into high multiplier prize gift boxes!",
        "Watch the physics coin bounce between glowing pegs toward the jackpot!",
        "Aim for the high-multiplier corners and collect giant gift rewards!"
      ]
    }
  };

  let currentBannerHooks = [];
  let currentBannerHookIdx = 0;

  function getSmartBannerData(opt) {
    if (!opt) return null;
    const title = opt.dataset.title || "";
    const url = opt.value || "";
    const desc = opt.dataset.desc || "";
    const img = opt.dataset.image || "";

    const key = Object.keys(BANNER_SMART_SUGGESTIONS).find(k => 
      url.toLowerCase().includes(k) || title.toLowerCase().includes(k)
    );
    if (key && BANNER_SMART_SUGGESTIONS[key]) {
      const s = BANNER_SMART_SUGGESTIONS[key];
      currentBannerHooks = s.hooks || [s.desc];
      currentBannerHookIdx = 0;
      return {
        title: s.title,
        theme: s.theme,
        badge: s.badge,
        badge2: s.badge2,
        desc: s.desc,
        cta: s.cta || `Play ${title}`,
        url,
        image: img
      };
    }

    // Dynamic generation for custom games
    const lower = `${title} ${desc}`.toLowerCase();
    let theme = "slide-speedway";
    let badge = "HOT 🔥";
    let badge2 = "FEATURED";
    let hooks = [
      desc || `Play ${title} instantly in the Ghost Plays arcade!`,
      `Experience high-speed action and compete for top ranks in ${title}!`,
      `The hottest new release in the arcade catalog! Play ${title} now!`,
      `Shatter high scores and challenge friends in ${title}!`
    ];

    if (/space|galaxy|alien|shooter|invader|laser|cosmic/.test(lower)) {
      theme = "slide-invaders";
      badge = "SCI-FI 🚀";
      badge2 = "BOSS RAID";
      hooks = [
        `Blast through cosmic space fleets and defeat bosses in ${title}!`,
        `Upgrade your space artillery and conquer the star systems in ${title}!`,
        desc || `Retro space arcade action with colossal boss encounters!`
      ];
    } else if (/race|speed|run|dino|dash|car|moto/.test(lower)) {
      theme = "slide-speedway";
      badge = "SPEED ⚡";
      badge2 = "TURBO RAMP";
      hooks = [
        `High-speed velocity reflexes! Outrun the obstacles in ${title}!`,
        `Hit maximum velocity and shatter leaderboard records in ${title}!`,
        desc || `Endless speedway hurdles and neon obstacle dodging!`
      ];
    } else if (/puzzle|2048|tetris|word|sudoku|mine|match/.test(lower)) {
      theme = "slide-tetris";
      badge = "PUZZLE 🧩";
      badge2 = "BRAIN TEST";
      hooks = [
        `Test your logic and clear tricky combos in ${title}!`,
        `Brain-teasing puzzle action with satisfying neon clears in ${title}!`,
        desc || `Classic mind-bending puzzle fun for all skill levels!`
      ];
    } else if (/pvp|battle|fight|arena|versus|duel/.test(lower)) {
      theme = "slide-cyan";
      badge = "1v1 DUEL ⚔️";
      badge2 = "RANKED ELO";
      hooks = [
        `Challenge live rivals in intense 1v1 multiplayer showdowns!`,
        `Climb global arena rankings and prove your skills in ${title}!`,
        desc || `Real-time competitive battle arena with ranked ELO!`
      ];
    } else if (/jackpot|gold|coin|luck|bet|money|casino|aviator/.test(lower)) {
      theme = "slide-gold";
      badge = "JACKPOT 🏆";
      badge2 = "BIG WIN";
      hooks = [
        `High multiplier jackpot action! Multiply your coin balance!`,
        `Stake your tokens and aim for legendary top multipliers in ${title}!`,
        desc || `High-stakes multiplier thrills and rewards!`
      ];
    }

    currentBannerHooks = hooks;
    currentBannerHookIdx = 0;
    return {
      title: `${title.toUpperCase()}`,
      theme,
      badge,
      badge2,
      desc: hooks[0],
      cta: `Play ${title}`,
      url,
      image: img
    };
  }

  function applyBannerAutoSuggestions(data) {
    if (!data) return;
    const bTitle = document.getElementById("bannerTitle");
    if (bTitle) bTitle.value = data.title || "";

    const bTheme = document.getElementById("bannerTheme");
    if (bTheme && data.theme) bTheme.value = data.theme;

    const bBadge = document.getElementById("bannerBadge");
    if (bBadge) bBadge.value = data.badge || "";

    const bBadge2 = document.getElementById("bannerBadge2");
    if (bBadge2) bBadge2.value = data.badge2 || "";

    const bDesc = document.getElementById("bannerDesc");
    if (bDesc) bDesc.value = data.desc || "";

    const gUrl = document.getElementById("bannerGameUrl");
    if (gUrl) gUrl.value = data.url || "";

    const gTitle = document.getElementById("bannerGameTitle");
    if (gTitle) gTitle.value = data.cta || "";

    if (data.image) {
      const inputImg = document.getElementById("inputBannerImageUrl");
      if (inputImg) inputImg.value = data.image;
      const preview = document.getElementById("bannerImgPreview");
      if (preview) preview.src = data.image;
    }
  }

  document.getElementById("bannerSelectGame")?.addEventListener("change", (e) => {
    const sel = e.target;
    const opt = sel.options[sel.selectedIndex];
    if (!opt || !opt.value) return;
    const data = getSmartBannerData(opt);
    applyBannerAutoSuggestions(data);
    haptic("light");
  });

  document.getElementById("btnAutoSuggestBanner")?.addEventListener("click", () => {
    const sel = document.getElementById("bannerSelectGame");
    if (!sel || !sel.selectedIndex || !sel.value) {
      // Pick first game if none selected
      if (sel && sel.options.length > 1) {
        sel.selectedIndex = 1;
      } else {
        alert("Please select a game first or add one to the catalog!");
        return;
      }
    }
    const opt = sel.options[sel.selectedIndex];
    const data = getSmartBannerData(opt);
    applyBannerAutoSuggestions(data);
    haptic("medium");
  });

  document.getElementById("btnRandomizeHook")?.addEventListener("click", () => {
    if (!currentBannerHooks || !currentBannerHooks.length) {
      const sel = document.getElementById("bannerSelectGame");
      const opt = sel?.options[sel?.selectedIndex];
      if (opt && opt.value) getSmartBannerData(opt);
    }
    if (currentBannerHooks && currentBannerHooks.length > 1) {
      currentBannerHookIdx = (currentBannerHookIdx + 1) % currentBannerHooks.length;
      const hook = currentBannerHooks[currentBannerHookIdx];
      const bDesc = document.getElementById("bannerDesc");
      if (bDesc) bDesc.value = hook;
      haptic("light");
    }
  });

  document.querySelectorAll(".btn-preset-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      const style = pill.dataset.style;
      const bTheme = document.getElementById("bannerTheme");
      const bBadge = document.getElementById("bannerBadge");
      const bBadge2 = document.getElementById("bannerBadge2");
      const bDesc = document.getElementById("bannerDesc");
      const gTitle = document.getElementById("bannerGameTitle")?.value || "this game";

      haptic("light");
      if (style === "hot") {
        if (bTheme) bTheme.value = "slide-aviator";
        if (bBadge) bBadge.value = "HOT 🔥";
        if (bBadge2) bBadge2.value = "HIGH STAKES";
        if (bDesc) bDesc.value = `Intense high-stakes multiplier frenzy! Cash out before the crash in ${gTitle}!`;
      } else if (style === "speed") {
        if (bTheme) bTheme.value = "slide-speedway";
        if (bBadge) bBadge.value = "SPEED ⚡";
        if (bBadge2) bBadge2.value = "CYBERPUNK";
        if (bDesc) bDesc.value = `High-velocity reflex hurdles across glowing neon tracks! Play ${gTitle} now!`;
      } else if (style === "arcade") {
        if (bTheme) bTheme.value = "slide-invaders";
        if (bBadge) bBadge.value = "ARCADE 👾";
        if (bBadge2) bBadge2.value = "BOSS RAID";
        if (bDesc) bDesc.value = `Retro synthwave combat, giant boss battles, and high-energy laser warfare!`;
      } else if (style === "pvp") {
        if (bTheme) bTheme.value = "slide-cyan";
        if (bBadge) bBadge.value = "PVP ⚔️";
        if (bBadge2) bBadge2.value = "1v1 ARENA";
        if (bDesc) bDesc.value = `Real-time 1v1 multiplayer duel with rated ELO rankings and live clock pressure!`;
      } else if (style === "gold") {
        if (bTheme) bTheme.value = "slide-gold";
        if (bBadge) bBadge.value = "JACKPOT 🏆";
        if (bBadge2) bBadge2.value = "BIG WIN";
        if (bDesc) bDesc.value = `Exclusive tournament rewards and massive multiplier prizes waiting to be won!`;
      }
    });
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
    const bOrder = document.getElementById("bannerOrderIdx");
    if (bOrder) bOrder.value = "0";
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
    const bOrder = document.getElementById("bannerOrderIdx");
    if (bOrder) bOrder.value = b.order_idx ?? 0;
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
    const secret = getAdminSecret();
    try {
      const res = await fetch(`/api/admin/promo-banners/${id}?user_id=${encodeURIComponent(state.userId)}&admin_secret=${encodeURIComponent(secret)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        loadAdminBannersList();
        loadHeroCarouselBanners();
  loadShopConfig();
        if (typeof showToast === "function") showToast("Banner deleted from sliding window");
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || "Failed to delete banner. Check admin permissions.");
      }
    } catch (e) {
      alert("Error deleting banner: " + e.message);
    }
  }

  document.getElementById("btnNewBanner")?.addEventListener("click", resetBannerForm);
  document.getElementById("btnCancelEditBanner")?.addEventListener("click", resetBannerForm);

  async function loadAdminBannersList() {
    initAdminSecretInputs();
    const listEl = document.getElementById("adminBannersList");
    if (!listEl) return;
    listEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:12px;">Loading sliding banners...</div>';

    const secret = getAdminSecret();
    try {
      const res = await fetch(`/api/admin/promo-banners?user_id=${encodeURIComponent(state.userId)}&admin_secret=${encodeURIComponent(secret)}`);
      if (!res.ok) {
        listEl.innerHTML = '<div style="color:#ef4444;font-size:0.85rem;padding:12px;">⚠️ Admin permissions required to load banners. Enter Admin Secret passcode above.</div>';
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
      listEl.innerHTML = `<div style="color:#ef4444;font-size:0.85rem;padding:12px;">Error: ${escapeHtml(e.message)}</div>`;
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
    let admin_secret = getAdminSecret();

    if (!admin_secret && !state.isAdmin) {
      const prompted = prompt("🔐 Enter Admin Secret passcode to save sliding banners:");
      if (prompted && prompted.trim()) {
        admin_secret = prompted.trim();
        syncAdminSecret(admin_secret);
      } else {
        alert("⚠️ Admin Secret passcode is required to save sliding banners.");
        return;
      }
    }

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
      order_idx: parseInt(document.getElementById("bannerOrderIdx")?.value, 10) || 0,
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
        let msg = err.detail || "Failed to save banner";
        if (res.status === 403) {
          msg = "⚠️ " + msg + ". Please check your Admin Secret passcode.";
        }
        alert(msg);
        return;
      }

      resetBannerForm();
      loadAdminBannersList();
      loadHeroCarouselBanners();
  loadShopConfig();
      alert(isEdit ? "✅ Sliding banner updated successfully!" : "✅ New promo banner added to home slider!");
    } catch (err) {
      alert("Error saving banner: " + err.message);
    }
  });

  // =========================================================
  // ACETERNITY UI 3D CARD ENGINE
  // =========================================================
  function initAceternity3DCards() {
    let activeTiltingCard = null;

    function find3DCard(target) {
      if (!target || !target.closest) return null;
      return target.closest(
        ".custom-game-card, .arena-mode-card, .carousel-game-card, .trending-game-card, .category-card"
      );
    }

    function apply3DTilt(card, clientX, clientY) {
      const rect = card.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      // Max +/- 14 degree 3D rotation (matching Aceternity 3d-card physics)
      const rotateX = ((y - centerY) / centerY) * -14;
      const rotateY = ((x - centerX) / centerX) * 14;

      card.classList.add("is-tilting");
      card.style.transform = `perspective(1100px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale3d(1.035, 1.035, 1.035)`;
      card.style.setProperty("--mouse-x", `${((x / rect.width) * 100).toFixed(1)}%`);
      card.style.setProperty("--mouse-y", `${((y / rect.height) * 100).toFixed(1)}%`);
    }

    function reset3DTilt(card) {
      if (!card) return;
      card.classList.remove("is-tilting");
      card.style.transform = "perspective(1100px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)";
    }

    // High performance global event delegation
    document.addEventListener("pointermove", (e) => {
      // Allow touch scrolling without locking cards
      if (e.pointerType === "touch" && e.buttons === 0) return;
      const card = find3DCard(e.target);
      if (card) {
        if (activeTiltingCard && activeTiltingCard !== card) {
          reset3DTilt(activeTiltingCard);
        }
        activeTiltingCard = card;
        apply3DTilt(card, e.clientX, e.clientY);
      } else if (activeTiltingCard) {
        reset3DTilt(activeTiltingCard);
        activeTiltingCard = null;
      }
    }, { passive: true });

    document.addEventListener("pointerleave", () => {
      if (activeTiltingCard) {
        reset3DTilt(activeTiltingCard);
        activeTiltingCard = null;
      }
    });

    // Touch feedback for mobile & Telegram Mini App
    document.addEventListener("touchstart", (e) => {
      const touch = e.touches[0];
      if (!touch) return;
      const card = find3DCard(e.target);
      if (card) {
        apply3DTilt(card, touch.clientX, touch.clientY);
      }
    }, { passive: true });

    document.addEventListener("touchend", (e) => {
      const card = find3DCard(e.target);
      if (card) {
        setTimeout(() => reset3DTilt(card), 180);
      }
      if (activeTiltingCard) {
        reset3DTilt(activeTiltingCard);
        activeTiltingCard = null;
      }
    }, { passive: true });
  }

  // =========================================================
  // BUBBLE TEXT EFFECT (Hover.dev / Aceternity Wave)
  // =========================================================
  function initBubbleText() {
    const bubbleTargets = document.querySelectorAll(
      ".bubble-text, .hub-section-title, .comm-badge, .arena-head-pill, .studio-section-title, .hero-feature-title"
    );

    bubbleTargets.forEach((container) => {
      if (container.dataset.bubbleInit === "true") return;
      if (container.querySelector("button, input, select, form, .bubble-char")) return;

      const rawText = container.textContent.trim();
      if (!rawText || rawText.length < 2) return;

      container.dataset.bubbleInit = "true";
      const chars = Array.from(rawText);
      container.innerHTML = "";

      const charSpans = chars.map((ch) => {
        const span = document.createElement("span");
        span.className = "bubble-char";
        span.textContent = ch === " " ? "\u00A0" : ch;
        container.appendChild(span);
        return span;
      });

      charSpans.forEach((span, idx) => {
        span.addEventListener("mouseenter", () => {
          span.classList.add("bubble-active");
          if (charSpans[idx - 1]) charSpans[idx - 1].classList.add("bubble-near");
          if (charSpans[idx + 1]) charSpans[idx + 1].classList.add("bubble-near");
          if (charSpans[idx - 2]) charSpans[idx - 2].classList.add("bubble-far");
          if (charSpans[idx + 2]) charSpans[idx + 2].classList.add("bubble-far");
        });

        span.addEventListener("mouseleave", () => {
          span.classList.remove("bubble-active");
          if (charSpans[idx - 1]) charSpans[idx - 1].classList.remove("bubble-near");
          if (charSpans[idx + 1]) charSpans[idx + 1].classList.remove("bubble-near");
          if (charSpans[idx - 2]) charSpans[idx - 2].classList.remove("bubble-far");
          if (charSpans[idx + 2]) charSpans[idx + 2].classList.remove("bubble-far");
        });
      });

      // Mobile Touch Drag support for Bubble Text
      container.addEventListener("touchmove", (e) => {
        const touch = e.touches[0];
        if (!touch) return;
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        if (target && target.classList.contains("bubble-char") && container.contains(target)) {
          charSpans.forEach(s => s.classList.remove("bubble-active", "bubble-near", "bubble-far"));
          const curIdx = charSpans.indexOf(target);
          if (curIdx !== -1) {
            target.classList.add("bubble-active");
            if (charSpans[curIdx - 1]) charSpans[curIdx - 1].classList.add("bubble-near");
            if (charSpans[curIdx + 1]) charSpans[curIdx + 1].classList.add("bubble-near");
          }
        }
      }, { passive: true });

      container.addEventListener("touchend", () => {
        charSpans.forEach(s => s.classList.remove("bubble-active", "bubble-near", "bubble-far"));
      }, { passive: true });
    });
  }

  initAceternity3DCards();
  initBubbleText();
  loadCustomGames();
  initAuth();

  if (window.lucide) {
    window.lucide.createIcons();
  }
})();
