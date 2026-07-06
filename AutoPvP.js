// ==UserScript==
// @name         Auto PvP Bot 1.0
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Automates PvP solo matches: matchmaking, combat turns, skill usage, and re-queuing.
// @author       You
// @match        *demonicscans.org/pvp.*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(async function () {
    'use strict';

    // =========================================================================
    // --- Skills Dictionary (add new skills here) ---
    // =========================================================================
    const PVP_SKILLS = {
        '0':  { name: "Slash",          cost: 0, type: "attack",  target: "enemy",      icon: "/images/skills/slash.webp" },
        '-1': { name: "Power Slash",    cost: 9, type: "attack",  target: "enemy",      icon: "/images/skills/power_slash.webp" },
        '8':  { name: "Heal",           cost: 5, type: "support", target: "ally_alive",  icon: "/images/skills/Heal.webp" },
        '9':  { name: "Judgment Seal",  cost: 3, type: "attack",  target: "enemy",      icon: "/images/skills/Judgment Seal.webp" },
    };

    // =========================================================================
    // --- Config & State ---
    // =========================================================================
    const DEFAULT_PVP_CONFIG = {
        basicSkillId: '0',
        chosenSkillId: '9',
        supportSkillId: '8',
        healThreshold: 50,
        autoQueue: true,
        pollInterval: 1000,
        allowAnySkill: false,
    };

    let config = GM_getValue("veyra_pvp_config", { ...DEFAULT_PVP_CONFIG });
    // Ensure all keys exist after loading (in case new defaults were added)
    config = { ...DEFAULT_PVP_CONFIG, ...config };
    if (config.healSkillId) { config.supportSkillId = config.healSkillId; delete config.healSkillId; }
    if (config.allowSupportSpam !== undefined) { config.allowAnySkill = config.allowSupportSpam; delete config.allowSupportSpam; }

    let isRunning = GM_getValue("veyra_pvp_running", false);
    let matchId = null;
    let sinceLogId = 0;
    let enemyTargetKey = null;
    let myTargetKey = null;
    let abortController = null;

    // Session stats (persisted)
    let sessionStats = GM_getValue("veyra_pvp_stats", {
        matches: 0,
        wins: 0,
        losses: 0,
        skillUsage: {},
    });

    function saveStats() {
        GM_setValue("veyra_pvp_stats", sessionStats);
    }

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function getCookie(name) {
        const value = '; ' + document.cookie;
        const parts = value.split('; ' + name + '=');
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }

    function saveConfig() {
        GM_setValue("veyra_pvp_config", config);
    }

    // =========================================================================
    // --- UI ---
    // =========================================================================
    function setupUI() {
        const savedUI = GM_getValue("veyra_pvp_ui", {
            left: 'calc(100vw - 420px)',
            top: '50px',
            width: '400px',
            height: 'auto',
            minimized: false
        });

        const css = `
        #pvp-container {
            position: fixed;
            top: ${savedUI.top};
            left: ${savedUI.left};
            width: ${savedUI.width};
            height: ${savedUI.height};
            max-height: 80vh;
            min-width: 340px;
            background: rgba(15, 23, 42, 0.95);
            border: 1px solid #334155;
            border-radius: 8px;
            color: #e2e8f0;
            font-family: 'Segoe UI', sans-serif;
            z-index: 999999;
            display: flex;
            flex-direction: column;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(10px);
            resize: both;
            overflow: hidden;
            font-size: 13px;
        }
        #pvp-header {
            background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
            padding: 10px 14px;
            cursor: grab;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #334155;
            user-select: none;
        }
        #pvp-header:active { cursor: grabbing; }
        #pvp-title { font-weight: bold; font-size: 15px; display: flex; gap: 8px; align-items: center; }
        #pvp-content {
            display: flex;
            flex-direction: column;
            padding: 12px;
            overflow-y: auto;
            flex-grow: 1;
            gap: 12px;
        }
        .pvp-minimized { height: auto !important; min-height: 0 !important; padding-bottom: 0 !important; resize: none !important; }
        .pvp-minimized #pvp-content { display: none; }

        .pvp-section {
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 6px;
            padding: 10px;
        }
        .pvp-section-title {
            font-weight: bold;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #94a3b8;
            margin-bottom: 8px;
        }

        .pvp-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
        .pvp-row:last-child { margin-bottom: 0; }
        .pvp-row label { flex: 0 0 110px; font-size: 12px; color: #cbd5e1; }

        .pvp-row select, .pvp-row input[type="number"] {
            flex: 1;
            background: #0f172a;
            border: 1px solid #475569;
            color: white;
            padding: 5px 8px;
            border-radius: 4px;
            font-size: 12px;
            min-width: 0;
            box-sizing: border-box;
        }
        .pvp-row select:focus, .pvp-row input:focus { outline: 1px solid #3b82f6; border-color: #3b82f6; }

        .pvp-checkbox-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
        .pvp-checkbox-row input[type="checkbox"] { accent-color: #3b82f6; }

        #pvp-status-box {
            background: #0f172a;
            border: 1px solid #334155;
            border-radius: 4px;
            padding: 8px;
            font-size: 11px;
            color: #94a3b8;
            min-height: 40px;
            height: 60px;
            max-height: 200px;
            overflow-y: auto;
            resize: vertical;
            line-height: 1.6;
            word-wrap: break-word;
        }
        .pvp-status-line { margin: 0; }
        .pvp-status-action { color: #60a5fa; }
        .pvp-status-good { color: #4ade80; }
        .pvp-status-bad { color: #f87171; }
        .pvp-status-info { color: #fbbf24; }

        .pvp-stats-grid {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 8px;
            text-align: center;
        }
        .pvp-stat-item {
            background: #0f172a;
            border-radius: 4px;
            padding: 6px 4px;
        }
        .pvp-stat-value { font-size: 18px; font-weight: bold; color: white; }
        .pvp-stat-label { font-size: 10px; color: #64748b; text-transform: uppercase; }

        #pvp-skill-usage {
            font-size: 11px;
            color: #94a3b8;
            margin-top: 6px;
        }
        #pvp-skill-usage span { color: #e2e8f0; }

        .pvp-btn {
            padding: 8px 14px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: bold;
            font-size: 13px;
            width: 100%;
            transition: background 0.2s;
        }
        .pvp-btn-start { background: #3b82f6; color: white; }
        .pvp-btn-start:hover { background: #2563eb; }
        .pvp-btn-stop { background: #ef4444; color: white; }
        .pvp-btn-stop:hover { background: #dc2626; }
        .pvp-btn-minimize {
            background: none; border: none; color: #94a3b8; cursor: pointer;
            font-size: 18px; line-height: 1; padding: 0 4px;
        }
        .pvp-btn-minimize:hover { color: white; }
        `;
        GM_addStyle(css);

        // Build skill options for dropdowns
        const basicSkillOptions = Object.entries(PVP_SKILLS)
            .filter(([, s]) => s.cost === 0)
            .map(([id, s]) => '<option value="' + id + '"' + (config.basicSkillId === id ? ' selected' : '') + '>' + s.name + ' (Cost: ' + s.cost + ')</option>')
            .join('');

        const attackSkillOptions = Object.entries(PVP_SKILLS)
            .filter(([, s]) => config.allowAnySkill || s.type === 'attack')
            .map(([id, s]) => '<option value="' + id + '"' + (config.chosenSkillId === id ? ' selected' : '') + '>' + s.name + ' (Cost: ' + s.cost + ')</option>')
            .join('');

        const supportSkillOptions = Object.entries(PVP_SKILLS)
            .filter(([, s]) => config.allowAnySkill || s.type === 'support')
            .map(([id, s]) => '<option value="' + id + '"' + (config.supportSkillId === id ? ' selected' : '') + '>' + s.name + ' (Cost: ' + s.cost + ')</option>')
            .join('');

        const container = document.createElement('div');
        container.id = 'pvp-container';
        if (savedUI.minimized) container.classList.add('pvp-minimized');

        container.innerHTML = [
            '<div id="pvp-header">',
            '  <div id="pvp-title">\u2694\uFE0F AutoPvP 1.0</div>',
            '  <button class="pvp-btn-minimize" id="pvp-toggle-minimize">' + (savedUI.minimized ? '+' : '\u2014') + '</button>',
            '</div>',
            '<div id="pvp-content">',

            // --- Controls Section ---
            '  <div class="pvp-section">',
            '    <div class="pvp-section-title">Configuration</div>',
            '    <div class="pvp-row">',
            '      <label>Basic Attack</label>',
            '      <select id="pvp-basic-skill">' + basicSkillOptions + '</select>',
            '    </div>',
            '    <div class="pvp-row">',
            '      <label>Main Skill</label>',
            '      <select id="pvp-chosen-skill">' + attackSkillOptions + '</select>',
            '    </div>',
            '    <div class="pvp-row">',
            '      <label>Support Skill</label>',
            '      <select id="pvp-support-skill">' + supportSkillOptions + '</select>',
            '    </div>',
            '    <div class="pvp-row">',
            '      <label>Support at HP %</label>',
            '      <input type="number" id="pvp-heal-threshold" value="' + config.healThreshold + '" min="0" max="100">',
            '    </div>',
            '    <div class="pvp-checkbox-row" style="margin-top:6px;">',
            '      <input type="checkbox" id="pvp-auto-queue"' + (config.autoQueue ? ' checked' : '') + '>',
            '      <label for="pvp-auto-queue">Auto-queue next match</label>',
            '    </div>',
            '    <div class="pvp-checkbox-row" style="margin-top:6px;">',
            '      <input type="checkbox" id="pvp-allow-any-skill"' + (config.allowAnySkill ? ' checked' : '') + '>',
            '      <label for="pvp-allow-any-skill">Allow any skill on any field</label>',
            '    </div>',
            '  </div>',

            // --- Health Section ---
            '  <div class="pvp-section">',
            '    <div class="pvp-section-title">Combat Health</div>',
            '    <div class="pvp-row"><label>My HP:</label><span id="pvp-my-hp" style="font-weight:bold; color:#4ade80">0 / 0</span></div>',
            '    <div class="pvp-row"><label>Enemy HP:</label><span id="pvp-enemy-hp" style="font-weight:bold; color:#f87171">0 / 0</span></div>',
            '  </div>',

            // --- Status Section ---
            '  <div class="pvp-section">',
            '    <div class="pvp-section-title">Status</div>',
            '    <div id="pvp-status-box">Idle. Press Start to begin.</div>',
            '  </div>',

            // --- Stats Section ---
            '  <div class="pvp-section">',
            '    <div class="pvp-section-title">Session Stats</div>',
            '    <div class="pvp-stats-grid">',
            '      <div class="pvp-stat-item"><div class="pvp-stat-value" id="pvp-stat-matches">0</div><div class="pvp-stat-label">Matches</div></div>',
            '      <div class="pvp-stat-item"><div class="pvp-stat-value" id="pvp-stat-wins" style="color:#4ade80">0</div><div class="pvp-stat-label">Wins</div></div>',
            '      <div class="pvp-stat-item"><div class="pvp-stat-value" id="pvp-stat-losses" style="color:#f87171">0</div><div class="pvp-stat-label">Losses</div></div>',
            '    </div>',
            '    <div id="pvp-skill-usage"></div>',
            '    <button id="pvp-clear-stats-btn" class="pvp-btn" style="margin-top: 8px; background: #334155; color: white; padding: 4px; font-size: 11px;">Clear Match History</button>',
            '  </div>',

            // --- Start Button ---
            '  <button id="pvp-start-btn" class="pvp-btn ' + (isRunning ? 'pvp-btn-stop' : 'pvp-btn-start') + '">' + (isRunning ? 'Stop' : 'Start') + '</button>',

            '</div>',
        ].join('\n');

        document.body.appendChild(container);

        // --- Drag Logic ---
        const header = document.getElementById('pvp-header');
        let isDragging = false, startX, startY, initialX, initialY;
        header.addEventListener('mousedown', function (e) {
            if (e.target.id === 'pvp-toggle-minimize') return;
            isDragging = true;
            startX = e.clientX; startY = e.clientY;
            initialX = container.offsetLeft; initialY = container.offsetTop;
        });
        document.addEventListener('mousemove', function (e) {
            if (!isDragging) return;
            container.style.left = (initialX + e.clientX - startX) + 'px';
            container.style.top = (initialY + e.clientY - startY) + 'px';
            container.style.right = 'auto';
        });
        document.addEventListener('mouseup', function () {
            if (isDragging) {
                isDragging = false;
                savedUI.left = container.style.left;
                savedUI.top = container.style.top;
                GM_setValue("veyra_pvp_ui", savedUI);
            }
        });

        // --- Resize Observer ---
        const resizeObserver = new ResizeObserver(function () {
            if (!isDragging) {
                savedUI.width = container.style.width || (container.offsetWidth + 'px');
                savedUI.height = container.style.height || (container.offsetHeight + 'px');
                GM_setValue("veyra_pvp_ui", savedUI);
            }
        });
        resizeObserver.observe(container);

        // --- Minimize ---
        const minBtn = document.getElementById('pvp-toggle-minimize');
        minBtn.addEventListener('click', function () {
            container.classList.toggle('pvp-minimized');
            savedUI.minimized = container.classList.contains('pvp-minimized');
            minBtn.innerText = savedUI.minimized ? '+' : '\u2014';
            GM_setValue("veyra_pvp_ui", savedUI);
        });

        // --- Clear Stats ---
        document.getElementById('pvp-clear-stats-btn').addEventListener('click', function () {
            sessionStats = { matches: 0, wins: 0, losses: 0, skillUsage: {} };
            saveStats();
            updateStatsUI();
        });

        // --- Start / Stop ---
        document.getElementById('pvp-start-btn').addEventListener('click', function (e) {
            isRunning = !isRunning;
            GM_setValue("veyra_pvp_running", isRunning);
            e.target.innerText = isRunning ? 'Stop' : 'Start';
            e.target.className = isRunning ? 'pvp-btn pvp-btn-stop' : 'pvp-btn pvp-btn-start';
            if (isRunning) {
                mainLoop();
            } else {
                if (abortController) abortController.abort();
            }
        });

        // --- Config change listeners ---
        document.getElementById('pvp-basic-skill').addEventListener('change', function (e) {
            config.basicSkillId = e.target.value;
            saveConfig();
        });
        document.getElementById('pvp-chosen-skill').addEventListener('change', function (e) {
            config.chosenSkillId = e.target.value;
            saveConfig();
        });
        document.getElementById('pvp-support-skill').addEventListener('change', function (e) {
            config.supportSkillId = e.target.value;
            saveConfig();
        });
        document.getElementById('pvp-heal-threshold').addEventListener('change', function (e) {
            config.healThreshold = Number(e.target.value);
            saveConfig();
        });
        document.getElementById('pvp-auto-queue').addEventListener('change', function (e) {
            config.autoQueue = e.target.checked;
            saveConfig();
        });
        document.getElementById('pvp-allow-any-skill').addEventListener('change', function (e) {
            config.allowAnySkill = e.target.checked;
            saveConfig();

            const newAttackOptions = Object.entries(PVP_SKILLS)
                .filter(([, s]) => config.allowAnySkill || s.type === 'attack')
                .map(([id, s]) => '<option value="' + id + '"' + (config.chosenSkillId === id ? ' selected' : '') + '>' + s.name + ' (Cost: ' + s.cost + ')</option>')
                .join('');
            document.getElementById('pvp-chosen-skill').innerHTML = newAttackOptions;
            
            const newSupportOptions = Object.entries(PVP_SKILLS)
                .filter(([, s]) => config.allowAnySkill || s.type === 'support')
                .map(([id, s]) => '<option value="' + id + '"' + (config.supportSkillId === id ? ' selected' : '') + '>' + s.name + ' (Cost: ' + s.cost + ')</option>')
                .join('');
            document.getElementById('pvp-support-skill').innerHTML = newSupportOptions;
        });
    }

    // =========================================================================
    // --- UI Helpers ---
    // =========================================================================
    function setStatus(text, cssClass) {
        const box = document.getElementById('pvp-status-box');
        if (!box) return;
        const cls = cssClass ? ' class="pvp-status-line pvp-status-' + cssClass + '"' : ' class="pvp-status-line"';
        box.innerHTML = '<p' + cls + '>' + text + '</p>';
        box.scrollTop = box.scrollHeight;
    }

    function appendStatus(text, cssClass) {
        const box = document.getElementById('pvp-status-box');
        if (!box) return;
        const cls = cssClass ? ' class="pvp-status-line pvp-status-' + cssClass + '"' : ' class="pvp-status-line"';
        // Keep only last 6 lines
        const lines = box.querySelectorAll('.pvp-status-line');
        if (lines.length >= 6) lines[0].remove();
        const p = document.createElement('p');
        p.className = 'pvp-status-line' + (cssClass ? ' pvp-status-' + cssClass : '');
        p.textContent = text;
        box.appendChild(p);
        box.scrollTop = box.scrollHeight;
    }

    function updateStatsUI() {
        const el = function (id) { return document.getElementById(id); };
        if (el('pvp-stat-matches')) el('pvp-stat-matches').textContent = sessionStats.matches;
        if (el('pvp-stat-wins')) el('pvp-stat-wins').textContent = sessionStats.wins;
        if (el('pvp-stat-losses')) el('pvp-stat-losses').textContent = sessionStats.losses;

        const usageEl = document.getElementById('pvp-skill-usage');
        if (usageEl) {
            let totalSkills = 0;
            const parts = Object.entries(sessionStats.skillUsage).map(function (entry) {
                totalSkills += entry[1];
                var skillName = PVP_SKILLS[entry[0]] ? PVP_SKILLS[entry[0]].name : ('Skill ' + entry[0]);
                return skillName + ': <span>' + entry[1] + '</span>';
            });
            let text = parts.length > 0 ? parts.join(' &middot; ') : '';
            if (totalSkills > 0) {
                text = '<div style="margin-bottom: 4px; color: white;">Total Skills Used: <b>' + totalSkills + '</b></div>' + text;
            }
            usageEl.innerHTML = text;
        }
    }

    function trackSkillUsage(skillId) {
        if (!sessionStats.skillUsage[skillId]) sessionStats.skillUsage[skillId] = 0;
        sessionStats.skillUsage[skillId]++;
        saveStats();
        updateStatsUI();
    }

    function updateHealthUI(myHp, myMax, enemyHp, enemyMax) {
        const el = function (id) { return document.getElementById(id); };
        if (el('pvp-my-hp') && myMax) el('pvp-my-hp').textContent = myHp + ' / ' + myMax;
        if (el('pvp-enemy-hp') && enemyMax) el('pvp-enemy-hp').textContent = enemyHp + ' / ' + enemyMax;
    }

    // =========================================================================
    // --- API Functions ---
    // =========================================================================
    const BASE_URL = 'https://demonicscans.org';

    async function apiPost(endpoint, bodyParams) {
        const body = Object.entries(bodyParams)
            .map(function (e) { return encodeURIComponent(e[0]) + '=' + encodeURIComponent(e[1]); })
            .join('&');

        const resp = await fetch(BASE_URL + '/' + endpoint, {
            method: 'POST',
            headers: {
                'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'x-requested-with': 'XMLHttpRequest',
            },
            body: body,
            credentials: 'include',
        });
        return resp.json();
    }

    async function apiGet(endpoint, params) {
        const qs = Object.entries(params)
            .map(function (e) { return encodeURIComponent(e[0]) + '=' + encodeURIComponent(e[1]); })
            .join('&');

        const resp = await fetch(BASE_URL + '/' + endpoint + '?' + qs, {
            method: 'GET',
            credentials: 'include',
        });
        return resp.json();
    }

    async function startMatchmaking() {
        return apiPost('pvp_matchmake.php', { ladder: 'solo' });
    }

    async function pollBattleState() {
        return apiGet('pvp_battle_state.php', {
            match_id: matchId,
            since_log_id: sinceLogId,
        });
    }

    async function performAction(actionType, extraParams) {
        var params = {
            match_id: matchId,
            since_log_id: sinceLogId,
            action: actionType,
        };
        if (extraParams) {
            Object.keys(extraParams).forEach(function (k) {
                params[k] = extraParams[k];
            });
        }
        return apiPost('pvp_battle_action.php', params);
    }

    async function useSkill(skillId, targetKey) {
        return performAction('use_skill', {
            skill_id: skillId,
            target_key: targetKey,
        });
    }

    async function setFastEnemyTurns() {
        return performAction('set_solo_control_mode', {
            control_mode: 'fast_enemy',
        });
    }

    // =========================================================================
    // --- Skill Decision Logic ---
    // =========================================================================
    function decideSkill(meData, teamsData) {
        var myTeamData = teamsData.ally.players_by_num;
        var myPlayer = null;
        Object.values(myTeamData).forEach(function (p) {
            if (String(p.user_id) === String(getCookie('demon'))) myPlayer = p;
        });

        if (!myPlayer) {
            myPlayer = Object.values(myTeamData)[0];
        }

        var tokens = meData.tokens;
        var hp = myPlayer.hp;
        var hpMax = myPlayer.hp_max;
        var hpPct = (hp / hpMax) * 100;

        var chosenSkill = PVP_SKILLS[config.chosenSkillId];
        var supportSkill = PVP_SKILLS[config.supportSkillId];
        var basicSkill = PVP_SKILLS[config.basicSkillId] || PVP_SKILLS['0'];

        // Priority 1: Support Skill check (HP threshold)
        if (supportSkill) {
            if (hpPct <= config.healThreshold) {
                if (tokens >= supportSkill.cost) {
                    var supportTarget = supportSkill.target === 'ally_alive' ? myTargetKey : enemyTargetKey;
                    return { skillId: config.supportSkillId, targetKey: supportTarget, reason: 'HP low (' + Math.round(hpPct) + '%), using support skill' };
                } else {
                    // Not enough tokens to use support skill -> build tokens with basic attack
                    var buildTarget = basicSkill.target === 'ally_alive' ? myTargetKey : enemyTargetKey;
                    return { skillId: config.basicSkillId, targetKey: buildTarget, reason: 'HP low, building tokens for support (' + tokens + '/' + supportSkill.cost + ')' };
                }
            }
        }

        // Priority 2: Use Main Skill if enough tokens
        if (chosenSkill && tokens >= chosenSkill.cost && chosenSkill.cost > 0) {
            var targetKey = chosenSkill.target === 'ally_alive' ? myTargetKey : enemyTargetKey;
            return { skillId: config.chosenSkillId, targetKey: targetKey, reason: 'Using ' + chosenSkill.name + ' (tokens: ' + tokens + ')' };
        }

        // Priority 3: Basic Attack to restore tokens
        var basicTarget = basicSkill.target === 'ally_alive' ? myTargetKey : enemyTargetKey;
        return { skillId: config.basicSkillId, targetKey: basicTarget, reason: 'Restoring tokens with basic attack (tokens: ' + tokens + ')' };
    }

    // =========================================================================
    // --- Main Loop ---
    // =========================================================================
    async function mainLoop() {
        abortController = new AbortController();

        while (isRunning) {
            try {
                // ---- Step 1: Start or rejoin a match ----
                setStatus('Starting matchmaking...', 'action');
                var mmResult = await startMatchmaking();

                if (!mmResult || mmResult.status !== 'success') {
                    setStatus('Matchmaking failed: ' + (mmResult ? mmResult.message : 'No response'), 'bad');
                    await sleep(3000);
                    continue;
                }

                matchId = mmResult.match_id;
                sinceLogId = 0;

                if (mmResult.message && mmResult.message.includes('active match')) {
                    appendStatus('Rejoining active match #' + matchId, 'info');
                } else {
                    appendStatus('Match found! #' + matchId, 'good');
                }

                // ---- Step 2: Initial state poll to get teams & skills ----
                await sleep(1000);
                var initState = await pollBattleState();
                if (!initState || !initState.ok) {
                    appendStatus('Failed to get initial state, retrying...', 'bad');
                    await sleep(2000);
                    continue;
                }

                sinceLogId = initState.last_log_id || 0;

                // Extract target keys
                var myUserId = getCookie('demon');
                myTargetKey = 'ally:' + myUserId;

                // Find enemy
                var enemyPlayers = initState.teams && initState.teams.enemy ? initState.teams.enemy.players_by_num : {};
                var firstEnemy = Object.values(enemyPlayers)[0];
                if (firstEnemy) {
                    enemyTargetKey = 'enemy:' + firstEnemy.user_id;
                    appendStatus('vs ' + firstEnemy.username + ' (' + firstEnemy.role + ')', 'info');
                } else {
                    enemyTargetKey = null;
                    appendStatus('Could not find enemy, waiting...', 'bad');
                }

                // ---- Step 3: Set fast enemy turns ----
                try {
                    await setFastEnemyTurns();
                    appendStatus('Fast enemy turns enabled', 'good');
                } catch (e) {
                    appendStatus('Could not set fast enemy turns', 'bad');
                }

                // ---- Step 4: Combat loop ----
                var matchEnded = false;
                var turnCount = 0;

                while (isRunning && !matchEnded) {
                    // Poll state
                    var state;
                    try {
                        state = await pollBattleState();
                    } catch (e) {
                        await sleep(config.pollInterval);
                        continue;
                    }

                    if (!state || !state.ok) {
                        await sleep(config.pollInterval);
                        continue;
                    }

                    sinceLogId = state.last_log_id || sinceLogId;

                    // Update Health
                    if (state.teams && state.teams.ally && state.teams.enemy) {
                        var myPlayer = Object.values(state.teams.ally.players_by_num).find(p => String(p.user_id) === String(getCookie('demon'))) || Object.values(state.teams.ally.players_by_num)[0];
                        var enemyPlayer = Object.values(state.teams.enemy.players_by_num)[0];
                        if (myPlayer && enemyPlayer) {
                            updateHealthUI(myPlayer.hp, myPlayer.hp_max, enemyPlayer.hp, enemyPlayer.hp_max);
                        }
                    }

                    // Check if match ended
                    if (state.match && state.match.ended) {
                        matchEnded = true;
                        sessionStats.matches++;
                        if (state.match.winner_side === 'ally') {
                            sessionStats.wins++;
                            setStatus('Match #' + matchId + ' ended: Victory!', 'good');
                        } else {
                            sessionStats.losses++;
                            setStatus('Match #' + matchId + ' ended: Defeat.', 'bad');
                        }
                        saveStats();
                        updateStatsUI();
                        break;
                    }

                    // Check if it's our turn
                    if (!state.turn || state.turn.side !== 'ally') {
                        // Enemy turn or waiting, just poll again
                        await sleep(config.pollInterval);
                        continue;
                    }

                    // It's our turn!
                    turnCount++;
                    var decision = decideSkill(state.me, state.teams);

                    if (!decision.targetKey) {
                        appendStatus('No valid target, waiting...', 'bad');
                        await sleep(config.pollInterval);
                        continue;
                    }

                    // Use the skill
                    try {
                        var actionResult = await useSkill(decision.skillId, decision.targetKey);

                        if (actionResult && actionResult.ok) {
                            sinceLogId = actionResult.last_log_id || sinceLogId;
                            trackSkillUsage(decision.skillId);

                            var skillName = PVP_SKILLS[decision.skillId] ? PVP_SKILLS[decision.skillId].name : ('Skill ' + decision.skillId);
                            appendStatus('T' + turnCount + ': ' + skillName + ' | ' + decision.reason, 'action');

                            // Update enemy target key if needed (in case enemy changed)
                            if (actionResult.teams && actionResult.teams.enemy) {
                                var updatedEnemy = Object.values(actionResult.teams.enemy.players_by_num)[0];
                                if (updatedEnemy) enemyTargetKey = 'enemy:' + updatedEnemy.user_id;
                            }

                            // Check if match ended from action response
                            if (actionResult.match && actionResult.match.ended) {
                                matchEnded = true;
                                sessionStats.matches++;
                                if (actionResult.match.winner_side === 'ally') {
                                    sessionStats.wins++;
                                    setStatus('Match #' + matchId + ' ended: Victory!', 'good');
                                } else {
                                    sessionStats.losses++;
                                    setStatus('Match #' + matchId + ' ended: Defeat.', 'bad');
                                }
                                saveStats();
                                updateStatsUI();
                                break;
                            }
                        } else {
                            // Action failed (possibly not our turn anymore, or bad request)
                            var errMsg = actionResult && actionResult.message ? actionResult.message : 'Action failed';
                            appendStatus(errMsg, 'bad');
                        }
                    } catch (e) {
                        appendStatus('Action error: ' + e.message, 'bad');
                    }

                    // Small delay before next poll
                    await sleep(config.pollInterval);
                }

                // ---- Post-match ----
                if (!isRunning) break;

                if (config.autoQueue) {
                    appendStatus('Queuing next match in 3s...', 'info');
                    await sleep(3000);
                } else {
                    setStatus('Match over. Auto-queue is off.', 'info');
                    isRunning = false;
                    var btn = document.getElementById('pvp-start-btn');
                    if (btn) {
                        btn.innerText = 'Start';
                        btn.className = 'pvp-btn pvp-btn-start';
                    }
                }

            } catch (loopError) {
                appendStatus('Loop error: ' + loopError.message, 'bad');
                await sleep(3000);
            }
        }
    }

    // =========================================================================
    // --- Initialize (Multi-Tab Safety) ---
    // =========================================================================
    let isMaster = false;
    const bc = new BroadcastChannel('veyra_pvp_channel');

    bc.onmessage = (e) => {
        if (e.data === 'whois_master' && isMaster) {
            bc.postMessage('iam_master');
        }
    };

    // Stagger start slightly to avoid exact simultaneous load races
    await sleep(Math.random() * 200);

    let gotReply = false;
    const checkListener = (e) => { if (e.data === 'iam_master') gotReply = true; };
    bc.addEventListener('message', checkListener);

    bc.postMessage('whois_master');
    await sleep(300);
    bc.removeEventListener('message', checkListener);

    if (gotReply) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed; top:20px; left:calc(50vw - 180px); width:360px; text-align:center; background:rgba(239,68,68,0.9); color:white; padding:12px 24px; border-radius:8px; z-index:999999; font-family:sans-serif; font-weight:bold; box-shadow:0 4px 12px rgba(0,0,0,0.5); cursor:grab; user-select:none; box-sizing:border-box;';
        overlay.innerHTML = '⚔️ <b>AutoPvP</b>: Already running on another tab.';
        document.body.appendChild(overlay);

        let isDraggingOverlay = false, startX, startY, initialX, initialY;
        overlay.addEventListener('mousedown', e => {
            isDraggingOverlay = true;
            startX = e.clientX; startY = e.clientY;
            initialX = overlay.offsetLeft; initialY = overlay.offsetTop;
            overlay.style.cursor = 'grabbing';
        });
        document.addEventListener('mousemove', e => {
            if (!isDraggingOverlay) return;
            overlay.style.left = `${initialX + e.clientX - startX}px`;
            overlay.style.top = `${initialY + e.clientY - startY}px`;
        });
        document.addEventListener('mouseup', () => {
            if (isDraggingOverlay) {
                isDraggingOverlay = false;
                overlay.style.cursor = 'grab';
            }
        });
        console.log("AutoPvP disabled: Master lock held by another tab.");
    } else {
        isMaster = true;
        setupUI();
        updateStatsUI();

        if (isRunning) mainLoop();
    }

})();
