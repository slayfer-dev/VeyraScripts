// ==UserScript==
// @name         Auto PvP Matchmaking
// @namespace    https://demonicscans.org/scripts/
// @version      2.1
// @updateURL    https://raw.githubusercontent.com/slayfer-dev/VeyraScripts/refs/heads/main/src/AutoPvP.user.js
// @downloadURL  https://raw.githubusercontent.com/slayfer-dev/VeyraScripts/refs/heads/main/src/AutoPvP.user.js
// @description  Automates PvP solo matches with premium UI, background tabs, history, and audio notifications.
// @author       Slayfer
// @match        https://demonicscans.org/pvp.php*
// @require      https://raw.githubusercontent.com/slayfer-dev/VeyraScripts/refs/heads/main/libs/AntiThrottle.js
// @grant        GM.getValue
// @grant        GM.setValue
// ==/UserScript==

(async function () {
    'use strict';
    try {

    // =========================================================================
    // --- Skills Dictionary ---
    // =========================================================================
    const PVP_SKILLS = {
        // Basic Skills
        '0':  { name: "Slash",          cost: 0, type: "attack",  target: "enemy",      icon: "/images/skills/slash.webp" },
        '-1': { name: "Power Slash",    cost: 9, type: "attack",  target: "enemy",      icon: "/images/skills/power_slash.webp" },
        // Cleric Skills
        '8':  { name: "Heal",           cost: 5, type: "support", target: "ally_alive", icon: "/images/skills/Heal.webp" },
        '9':  { name: "Judgment Seal",  cost: 3, type: "attack",  target: "enemy",      icon: "/images/skills/Judgment Seal.webp" },
        // Hunter Skills
        '6':  { name: "Back Stab",  cost: 3, type: "attack",  target: "enemy",      icon: "/images/skills/Back Stab.webp" },
        '7':  { name: "Killer Instinct",  cost: 5, type: "support",  target: "enemy",      icon: "/images/skills/Killer Instinct.webp" },
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
        soundMatchEnd: true,
        soundNoTokens: true,
        retryNoTokens: false,
        showStandbyWarning: true
    };

    let config = await GM.getValue("veyra_pvp2_config", null);
    config = { ...DEFAULT_PVP_CONFIG, ...(config || {}) };

    let isRunning = await GM.getValue("veyra_pvp2_running", false);
    let matchId = null;
    let sinceLogId = 0;
    let enemyTargetKey = null;
    let myTargetKey = null;
    let abortController = null;
    let myTabId = sessionStorage.getItem("veyra_pvp2_tab_id");
    const navType = performance.getEntriesByType('navigation')[0]?.type;
    
    // If the tab was duplicated, it copies the sessionStorage but triggers a 'navigate' event.
    // We only trust the saved ID if this was a strict 'reload' (F5 refresh).
    if (!myTabId || navType !== 'reload') {
        myTabId = Math.random().toString(36).substr(2, 9);
        sessionStorage.setItem("veyra_pvp2_tab_id", myTabId);
    }
    
    // Live match state for resumption
    let activeMatchState = await GM.getValue("veyra_pvp2_active_match", null);
    if (!activeMatchState) activeMatchState = { matchId: null, turnCount: 0, skillUsage: {} };

    // Session stats & History
    let sessionStats = await GM.getValue("veyra_pvp2_stats", null);
    if (!sessionStats) sessionStats = { matches: 0, wins: 0, losses: 0, history: [], globalSkills: {} };
    if (!sessionStats.globalSkills) sessionStats.globalSkills = {};

    async function saveStats() {
        await GM.setValue("veyra_pvp2_stats", sessionStats);
    }
    async function saveConfig() {
        await GM.setValue("veyra_pvp2_config", config);
    }
    async function saveActiveMatch() {
        await GM.setValue("veyra_pvp2_active_match", activeMatchState);
    }

    let isMaster = false;
    // Lock logic is now handled by initLockManager at the bottom

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function getCookie(name) {
        const value = '; ' + document.cookie;
        const parts = value.split('; ' + name + '=');
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }

    // =========================================================================
    // --- Audio ---
    // =========================================================================
    function playChime() {
        if (!config.soundMatchEnd) return;
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const playTone = (freq, time, dur) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0, time);
                gain.gain.linearRampToValueAtTime(0.5, time + 0.05);
                gain.gain.exponentialRampToValueAtTime(0.01, time + dur);
                osc.start(time);
                osc.stop(time + dur);
            };
            const now = ctx.currentTime;
            playTone(523.25, now, 0.4); 
            playTone(659.25, now + 0.2, 0.6); 
        } catch(e) {}
    }

    function playErrorBeep() {
        if (!config.soundNoTokens) return;
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            osc.type = 'square';
            osc.frequency.setValueAtTime(150, ctx.currentTime);
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
            osc.start();
            osc.stop(ctx.currentTime + 0.5);
        } catch(e) {}
    }

    // =========================================================================
    // --- UI ---
    // =========================================================================
    async function setupUI() {
        let savedUI = await GM.getValue("veyra_pvp2_ui", null);
        if (!savedUI || typeof savedUI !== 'object') savedUI = {};
        if (!savedUI.left) savedUI.left = 'calc(100vw - 420px)';
        if (!savedUI.top) savedUI.top = '50px';
        if (!savedUI.width) savedUI.width = '400px';
        if (savedUI.minimized === undefined) savedUI.minimized = false;
        if (!savedUI.activeTab) savedUI.activeTab = 'matchmaking';

        const css = `
        #pvp-container {
            position: fixed;
            top: ${savedUI.top};
            left: ${savedUI.left};
            width: ${savedUI.width};
            min-width: 350px;
            background: rgba(15, 12, 20, 0.95);
            border: 1px solid rgba(241, 201, 107, 0.6);
            border-radius: 12px;
            color: #f8ead2;
            font-family: Georgia, "Times New Roman", serif;
            z-index: 999999;
            display: flex;
            flex-direction: column;
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(12px);
            resize: horizontal;
            overflow: hidden;
            font-size: 13px;
        }
        #pvp-header {
            background: rgba(0,0,0,0.3);
            padding: 10px 14px;
            cursor: grab;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid rgba(255,255,255,0.1);
            user-select: none;
        }
        #pvp-header:active { cursor: grabbing; }
        #pvp-title { font-weight: bold; font-size: 15px; color: #ffd88a; }
        .pvp-btn-minimize { background: none; border: none; color: #d9b66f; cursor: pointer; font-size: 18px; font-weight: bold; }
        .pvp-btn-minimize:hover { color: white; }

        .pvp-tabs { display: flex; border-bottom: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.02); }
        .pvp-tab { padding: 8px 16px; cursor: pointer; font-weight: bold; color: #cdbfba; transition: 0.2s; border-bottom: 2px solid transparent; flex:1; text-align:center;}
        .pvp-tab:hover { color: #f8ead2; background: rgba(255,255,255,0.05); }
        .pvp-tab.active { color: #ffd88a; border-bottom-color: #d9b66f; background: rgba(255,255,255,0.08); }

        #pvp-content { padding: 12px; max-height: 70vh; overflow-y: auto; }
        .pvp-minimized #pvp-content, .pvp-minimized .pvp-tabs { display: none; }

        .pvp-tab-content { display: none; flex-direction: column; gap: 12px; }
        .pvp-tab-content.active { display: flex; }

        .pvp-section { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 10px; }
        .pvp-section-title { font-weight: bold; font-size: 11px; text-transform: uppercase; color: #d9b66f; margin-bottom: 8px; }

        .pvp-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        .pvp-row label { font-size: 12px; color: #cdbfba; flex: 1; }
        .pvp-row select, .pvp-row input[type="number"] {
            background: #221b28; color: #f8ead2; border: 1px solid #555; padding: 5px; border-radius: 4px; flex: 1;
        }

        .pvp-checkbox-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
        
        #pvp-status-box {
            background: #110e14; border: 1px solid #444; border-radius: 4px; padding: 8px; font-size: 11px;
            color: #cdbfba; height: 120px; overflow-y: auto; font-family: monospace; line-height: 1.4;
        }
        .pvp-status-action { color: #6db3f2; }
        .pvp-status-good { color: #4ade80; }
        .pvp-status-bad { color: #f87171; }
        .pvp-status-info { color: #fbbf24; }

        .pvp-btn {
            padding: 8px 14px; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; width: 100%; transition: 0.2s;
        }
        .pvp-btn-start { background: #d9b66f; color: #1b1210; }
        .pvp-btn-start:hover { background: #ffd88a; }
        .pvp-btn-stop { background: #cf2d45; color: white; }
        .pvp-btn-stop:hover { background: #ef4444; }

        .pvp-history-item { background: rgba(255,255,255,0.05); padding: 8px; border-radius: 6px; margin-bottom: 6px; font-size: 12px;}
        .pvp-history-win { border-left: 4px solid #4ade80; }
        .pvp-history-loss { border-left: 4px solid #f87171; }
        `;
        const styleEl = document.createElement('style');
        styleEl.textContent = css;
        document.head.appendChild(styleEl);

        const getOpts = (filterFn, selectedId) => Object.entries(PVP_SKILLS)
            .filter(filterFn)
            .map(([id, s]) => '<option value="' + id + '"' + (selectedId === id ? ' selected' : '') + '>' + s.name + ' (' + s.cost + ')' + '</option>')
            .join('');

        const container = document.createElement('div');
        container.id = 'pvp-container';
        if (savedUI.minimized) container.classList.add('pvp-minimized');

        container.innerHTML = `
            <div id="pvp-header">
                <div id="pvp-title">⚔️ AutoPvP 2.0</div>
                <button class="pvp-btn-minimize" id="pvp-toggle-min">${savedUI.minimized ? '+' : '×'}</button>
            </div>
            <div class="pvp-tabs">
                <div class="pvp-tab ${savedUI.activeTab === 'matchmaking' ? 'active' : ''}" data-tab="matchmaking">Match</div>
                <div class="pvp-tab ${savedUI.activeTab === 'history' ? 'active' : ''}" data-tab="history">Historial</div>
                <div class="pvp-tab ${savedUI.activeTab === 'config' ? 'active' : ''}" data-tab="config">Config</div>
            </div>
            <div id="pvp-content">
                
                <!-- MATCHMAKING TAB -->
                <div class="pvp-tab-content ${savedUI.activeTab === 'matchmaking' ? 'active' : ''}" id="tab-matchmaking">
                    <div class="pvp-section" style="display:flex; justify-content:space-between; font-weight:bold;">
                        <span style="color:#4ade80" id="pvp-my-hp">Me: ?/?</span>
                        <span style="color:#f87171" id="pvp-enemy-hp">Enemy: ?/?</span>
                    </div>
                    <div class="pvp-section">
                        <div class="pvp-section-title">Live Status</div>
                        <div id="pvp-status-box">Idle.</div>
                    </div>
                    <div class="pvp-section">
                        <div class="pvp-section-title">Session Skills Used</div>
                        <div id="pvp-global-skills-match" style="font-size:12px; color:#cdbfba;"></div>
                    </div>
                    <button id="pvp-start-btn" class="pvp-btn ${isRunning ? 'pvp-btn-stop' : 'pvp-btn-start'}">${isRunning ? 'Stop AutoPvP' : 'Start AutoPvP'}</button>
                </div>

                <!-- HISTORY TAB -->
                <div class="pvp-tab-content ${savedUI.activeTab === 'history' ? 'active' : ''}" id="tab-history">
                    <div class="pvp-section" style="display:flex; justify-content:space-around; font-size:14px; font-weight:bold;">
                        <span>Total: <span id="hist-total">${sessionStats.matches}</span></span>
                        <span style="color:#4ade80">W: <span id="hist-wins">${sessionStats.wins}</span></span>
                        <span style="color:#f87171">L: <span id="hist-losses">${sessionStats.losses}</span></span>
                    </div>
                    <div class="pvp-section">
                        <div class="pvp-section-title">Session Skills Used</div>
                        <div id="pvp-global-skills-hist" style="font-size:12px; color:#cdbfba;"></div>
                    </div>
                    <button id="pvp-clear-hist" class="pvp-btn" style="background:#444; color:white; padding:4px;">Clear History</button>
                    <div id="pvp-history-list" style="margin-top:10px;"></div>
                </div>

                <!-- CONFIG TAB -->
                <div class="pvp-tab-content ${savedUI.activeTab === 'config' ? 'active' : ''}" id="tab-config">
                    <div class="pvp-section">
                        <div class="pvp-section-title">Combat Skills</div>
                        <div class="pvp-row">
                            <label>Basic Attack (0-cost)</label>
                            <select id="pvp-basic">${getOpts(([,s]) => s.cost === 0, config.basicSkillId)}</select>
                        </div>
                        <div class="pvp-row">
                            <label>Main Skill</label>
                            <select id="pvp-main">${getOpts(([,s]) => config.allowAnySkill || s.type === 'attack', config.chosenSkillId)}</select>
                        </div>
                        <div class="pvp-row">
                            <label>Support Skill</label>
                            <select id="pvp-support">${getOpts(([,s]) => config.allowAnySkill || s.type === 'support', config.supportSkillId)}</select>
                        </div>
                        <div class="pvp-row">
                            <label>Support HP %</label>
                            <input type="number" id="pvp-threshold" value="${config.healThreshold}" min="0" max="100">
                        </div>
                        <div class="pvp-checkbox-row">
                            <input type="checkbox" id="pvp-any-skill" ${config.allowAnySkill ? 'checked' : ''}>
                            <label>Allow any skill on any field</label>
                        </div>
                    </div>
                    <div class="pvp-section">
                        <div class="pvp-section-title">System</div>
                        <div class="pvp-checkbox-row">
                            <input type="checkbox" id="pvp-autoqueue" ${config.autoQueue ? 'checked' : ''}>
                            <label>Auto-queue next match</label>
                        </div>
                        <div class="pvp-checkbox-row">
                            <input type="checkbox" id="pvp-sound-end" ${config.soundMatchEnd ? 'checked' : ''}>
                            <label>Play sound on Match End</label>
                        </div>
                        <div class="pvp-checkbox-row">
                            <input type="checkbox" id="pvp-sound-tokens" ${config.soundNoTokens ? 'checked' : ''}>
                            <label>Play sound when Out of Tokens</label>
                        </div>
                        <div class="pvp-checkbox-row">
                            <input type="checkbox" id="pvp-retry-tokens" ${config.retryNoTokens ? 'checked' : ''}>
                            <label>Keep retrying when Out of Tokens (checks every 60s)</label>
                        </div>
                        <div class="pvp-checkbox-row">
                            <input type="checkbox" id="pvp-standby-warn" ${config.showStandbyWarning ? 'checked' : ''}>
                            <label>Show visual warning on Standby tabs</label>
                        </div>
                    </div>
                </div>

            </div>
        `;
        document.body.appendChild(container);
        renderHistory();
        renderGlobalSkills();

        // Drag
        const header = document.getElementById('pvp-header');
        let isDragging = false, startX, startY, initialX, initialY;
        header.onpointerdown = (e) => {
            if (e.target.id === 'pvp-toggle-min') return;
            e.preventDefault(); isDragging = true;
            startX = e.clientX; startY = e.clientY;
            initialX = container.offsetLeft; initialY = container.offsetTop;
            header.style.cursor = "grabbing";
            try { header.setPointerCapture(e.pointerId); } catch(err){}
        };
        header.onpointermove = (e) => {
            if (!isDragging) return;
            container.style.left = (initialX + e.clientX - startX) + 'px';
            container.style.top = (initialY + e.clientY - startY) + 'px';
        };
        const stopDrag = async (e) => {
            if (!isDragging) return;
            isDragging = false; header.style.cursor = "grab";
            try { header.releasePointerCapture(e.pointerId); } catch(err){}
            if (container.style.left) savedUI.left = container.style.left;
            if (container.style.top) savedUI.top = container.style.top;
            await GM.setValue("veyra_pvp2_ui", savedUI);
        };
        header.onpointerup = stopDrag;
        header.onpointercancel = stopDrag;

        // Tabs
        document.querySelectorAll('.pvp-tab').forEach(tab => {
            tab.onclick = async () => {
                document.querySelectorAll('.pvp-tab, .pvp-tab-content').forEach(el => el.classList.remove('active'));
                tab.classList.add('active');
                const tName = tab.getAttribute('data-tab');
                document.getElementById('tab-' + tName).classList.add('active');
                savedUI.activeTab = tName;
                await GM.setValue("veyra_pvp2_ui", savedUI);
            };
        });

        // Min/Max
        document.getElementById('pvp-toggle-min').onclick = async () => {
            container.classList.toggle('pvp-minimized');
            savedUI.minimized = container.classList.contains('pvp-minimized');
            document.getElementById('pvp-toggle-min').innerText = savedUI.minimized ? '+' : '×';
            await GM.setValue("veyra_pvp2_ui", savedUI);
        };

        // Start/Stop
        document.getElementById('pvp-start-btn').onclick = async (e) => {
            isRunning = !isRunning;
            await GM.setValue("veyra_pvp2_running", isRunning);
            e.target.innerText = isRunning ? 'Stop AutoPvP' : 'Start AutoPvP';
            e.target.className = isRunning ? 'pvp-btn pvp-btn-stop' : 'pvp-btn pvp-btn-start';
            if (isRunning) mainLoop();
            else if (abortController) abortController.abort();
        };

        // Config Listeners
        const listen = (id, key, isCheckbox, isNum) => {
            document.getElementById(id).onchange = async (e) => {
                let val = isCheckbox ? e.target.checked : e.target.value;
                if (isNum) val = Number(val);
                config[key] = val;
                await saveConfig();
                
                // If 'any skill' changed, re-render dropdowns
                if (key === 'allowAnySkill') {
                    document.getElementById('pvp-main').innerHTML = getOpts(([,s]) => config.allowAnySkill || s.type === 'attack', config.chosenSkillId);
                    document.getElementById('pvp-support').innerHTML = getOpts(([,s]) => config.allowAnySkill || s.type === 'support', config.supportSkillId);
                }
            };
        };
        listen('pvp-basic', 'basicSkillId', false, false);
        listen('pvp-main', 'chosenSkillId', false, false);
        listen('pvp-support', 'supportSkillId', false, false);
        listen('pvp-threshold', 'healThreshold', false, true);
        listen('pvp-any-skill', 'allowAnySkill', true, false);
        listen('pvp-autoqueue', 'autoQueue', true, false);
        listen('pvp-sound-end', 'soundMatchEnd', true, false);
        listen('pvp-sound-tokens', 'soundNoTokens', true, false);
        listen('pvp-retry-tokens', 'retryNoTokens', true, false);
        listen('pvp-standby-warn', 'showStandbyWarning', true, false);

        // Clear History
        document.getElementById('pvp-clear-hist').onclick = async () => {
            sessionStats.matches = 0; sessionStats.wins = 0; sessionStats.losses = 0; sessionStats.history = []; sessionStats.globalSkills = {};
            await saveStats();
            document.getElementById('hist-total').innerText = 0;
            document.getElementById('hist-wins').innerText = 0;
            document.getElementById('hist-losses').innerText = 0;
            renderHistory();
            renderGlobalSkills();
        };
    }

    function renderHistory() {
        const list = document.getElementById('pvp-history-list');
        if (!list) return;
        if (sessionStats.history.length === 0) {
            list.innerHTML = '<div style="opacity:0.5; text-align:center;">No history yet.</div>';
            return;
        }
        list.innerHTML = sessionStats.history.map(m => {
            const cls = m.result === 'Win' ? 'pvp-history-win' : 'pvp-history-loss';
            const resColor = m.result === 'Win' ? '#4ade80' : '#f87171';
            const skillsStr = Object.entries(m.skills).length > 0
                ? '<ul style="margin: 2px 0 0 15px; padding: 0;">' + Object.entries(m.skills).map(([k,v]) => `<li>${PVP_SKILLS[k]?.name || k} x${v}</li>`).join('') + '</ul>'
                : 'None';
            return `
                <div class="pvp-history-item ${cls}">
                    <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                        <strong>Match #${m.id}</strong>
                        <span style="color:${resColor}; font-weight:bold;">${m.result}</span>
                    </div>
                    <div style="color:#cdbfba;">Turns: ${m.turns} | Time: ${m.time}</div>
                    <div style="color:#94a3b8; font-size:11px; margin-top:4px;">Skills: ${skillsStr}</div>
                </div>
            `;
        }).join('');
    }

    function renderGlobalSkills() {
        const skillsStr = Object.entries(sessionStats.globalSkills || {}).length > 0 
            ? '<ul style="margin: 2px 0 0 15px; padding: 0;">' + Object.entries(sessionStats.globalSkills).map(([k,v]) => `<li>${PVP_SKILLS[k]?.name || k} x${v}</li>`).join('') + '</ul>'
            : 'None';
        
        const mBox = document.getElementById('pvp-global-skills-match');
        const hBox = document.getElementById('pvp-global-skills-hist');
        if (mBox) mBox.innerHTML = skillsStr;
        if (hBox) hBox.innerHTML = skillsStr;
    }

    // =========================================================================
    // --- UI Helpers ---
    // =========================================================================
    function setStatus(text, cssClass) {
        const box = document.getElementById('pvp-status-box');
        if (!box) return;
        const cls = cssClass ? ` class="pvp-status-${cssClass}"` : '';
        box.innerHTML = `<p${cls}>${text}</p>`;
        box.scrollTop = box.scrollHeight;
    }

    function appendStatus(text, cssClass) {
        const box = document.getElementById('pvp-status-box');
        if (!box) return;
        const ps = box.querySelectorAll('p');
        if (ps.length >= 15) ps[0].remove();
        const p = document.createElement('p');
        if (cssClass) p.className = `pvp-status-${cssClass}`;
        p.textContent = text;
        p.style.margin = "2px 0";
        box.appendChild(p);
        box.scrollTop = box.scrollHeight;
    }

    function updateHealthUI(myHp, myMax, enemyHp, enemyMax) {
        const el1 = document.getElementById('pvp-my-hp');
        const el2 = document.getElementById('pvp-enemy-hp');
        if (el1 && myMax) el1.textContent = `Me: ${myHp}/${myMax}`;
        if (el2 && enemyMax) el2.textContent = `Enemy: ${enemyHp}/${enemyMax}`;
    }

    function pushHistory(matchId, resultStr, turnCount, skillUsageObj) {
        sessionStats.matches++;
        if (resultStr === 'Win') sessionStats.wins++;
        else sessionStats.losses++;

        sessionStats.history.unshift({
            id: matchId,
            result: resultStr,
            turns: turnCount,
            skills: JSON.parse(JSON.stringify(skillUsageObj)),
            time: new Date().toLocaleTimeString()
        });
        if (sessionStats.history.length > 10) sessionStats.history.pop();
        
        document.getElementById('hist-total').innerText = sessionStats.matches;
        document.getElementById('hist-wins').innerText = sessionStats.wins;
        document.getElementById('hist-losses').innerText = sessionStats.losses;
        renderHistory();
        saveStats(); // Note: No await here but it's safe to run in background
    }

    // =========================================================================
    // --- API Functions (with robust error handling) ---
    // =========================================================================
    const BASE_URL = 'https://demonicscans.org';

    async function safeFetch(url, options) {
        try {
            const resp = await fetch(url, options);
            if (!resp.ok) {
                return { status: 'error', message: `HTTP Error ${resp.status}`, ok: false };
            }
            return await resp.json();
        } catch (e) {
            return { status: 'error', message: e.message || 'Network Timeout/Failure', ok: false };
        }
    }

    async function apiPost(endpoint, bodyParams) {
        const body = Object.entries(bodyParams)
            .map(([k,v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
        return safeFetch(BASE_URL + '/' + endpoint, {
            method: 'POST',
            headers: {
                'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'x-requested-with': 'XMLHttpRequest',
            },
            body: body,
            credentials: 'include',
        });
    }

    async function apiGet(endpoint, params) {
        const qs = Object.entries(params)
            .map(([k,v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
        return safeFetch(BASE_URL + '/' + endpoint + '?' + qs, {
            method: 'GET',
            credentials: 'include',
        });
    }

    // =========================================================================
    // --- Skill Decision Logic ---
    // =========================================================================
    function decideSkill(meData, teamsData) {
        let myPlayer = null;
        Object.values(teamsData.ally.players_by_num).forEach(p => {
            if (String(p.user_id) === String(getCookie('demon'))) myPlayer = p;
        });
        if (!myPlayer) myPlayer = Object.values(teamsData.ally.players_by_num)[0];

        const tokens = meData.tokens;
        const hpPct = (myPlayer.hp / myPlayer.hp_max) * 100;

        const chosenSkill = PVP_SKILLS[config.chosenSkillId];
        const supportSkill = PVP_SKILLS[config.supportSkillId];
        const basicSkill = PVP_SKILLS[config.basicSkillId] || PVP_SKILLS['0'];

        if (supportSkill && hpPct <= config.healThreshold) {
            if (tokens >= supportSkill.cost) {
                const target = supportSkill.target === 'ally_alive' ? myTargetKey : enemyTargetKey;
                return { id: config.supportSkillId, target, reason: `HP low (${Math.round(hpPct)}%), using support` };
            } else {
                const target = basicSkill.target === 'ally_alive' ? myTargetKey : enemyTargetKey;
                return { id: config.basicSkillId, target, reason: `Building tokens for support (${tokens}/${supportSkill.cost})` };
            }
        }

        if (chosenSkill && tokens >= chosenSkill.cost && chosenSkill.cost > 0) {
            const target = chosenSkill.target === 'ally_alive' ? myTargetKey : enemyTargetKey;
            return { id: config.chosenSkillId, target, reason: `Using ${chosenSkill.name} (${tokens}t)` };
        }

        const basicTarget = basicSkill.target === 'ally_alive' ? myTargetKey : enemyTargetKey;
        return { id: config.basicSkillId, target: basicTarget, reason: `Restoring tokens (${tokens}t)` };
    }

    // =========================================================================
    // --- Main Loop ---
    // =========================================================================
    async function mainLoop() {
        abortController = new AbortController();

        while (isRunning) {
            try {
                // ---- Matchmaking / Resumption ----
                if (!activeMatchState.matchId) {
                    setStatus('Starting matchmaking...', 'info');
                    const mmResult = await apiPost('pvp_matchmake.php', { ladder: 'solo' });
                    
                    // If the server gives us a match_id, we can proceed even if status is 'error' (e.g. "already in an active match")
                    if (mmResult.status !== 'success' && !mmResult.match_id) {
                        const msg = mmResult.message || 'Network failure';
                        setStatus('Matchmaking failed: ' + msg, 'bad');
                        
                        // Check for 'no tokens'/'no energy'
                        if (msg.toLowerCase().includes('token') || msg.toLowerCase().includes('energy') || msg.toLowerCase().includes('no pvp tokens left')) {
                            if (config.retryNoTokens) {
                                appendStatus('Out of Tokens! Retrying in 60s...', 'info');
                                playErrorBeep();
                                await sleep(60000);
                                continue;
                            } else {
                                appendStatus('Out of PvP Tokens! Stopping.', 'bad');
                                playErrorBeep();
                                document.getElementById('pvp-start-btn').click(); // Turn off visually and logically
                                break;
                            }
                        }
                        
                        await sleep(3000);
                        continue;
                    }

                    activeMatchState.matchId = mmResult.match_id;
                    activeMatchState.turnCount = 0;
                    activeMatchState.skillUsage = {};
                    await saveActiveMatch();

                    if (mmResult.status !== 'success' || (mmResult.message && mmResult.message.includes('active match'))) {
                        appendStatus('Rejoining active match #' + activeMatchState.matchId, 'info');
                    } else {
                        appendStatus('Match found! #' + activeMatchState.matchId, 'good');
                    }
                } else {
                    appendStatus('Resuming existing match #' + activeMatchState.matchId, 'info');
                }

                matchId = activeMatchState.matchId;
                sinceLogId = 0;

                // ---- Initial state poll ----
                await sleep(1000);
                const initState = await apiGet('pvp_battle_state.php', { match_id: matchId, since_log_id: sinceLogId });
                
                // If the server says the match doesn't exist anymore, reset it
                if (!initState || (initState.status === 'error' && initState.message && initState.message.includes('not found'))) {
                    appendStatus('Match expired or not found. Resetting...', 'bad');
                    activeMatchState = { matchId: null, turnCount: 0, skillUsage: {} };
                    await saveActiveMatch();
                    continue;
                }
                
                if (initState.status === 'error') {
                    appendStatus('State fetch error, retrying...', 'bad');
                    await sleep(2000);
                    continue;
                }

                sinceLogId = initState.last_log_id || 0;
                const myUserId = getCookie('demon');
                myTargetKey = 'ally:' + myUserId;

                const enemyPlayers = initState.teams?.enemy?.players_by_num || {};
                const firstEnemy = Object.values(enemyPlayers)[0];
                if (firstEnemy) {
                    enemyTargetKey = 'enemy:' + firstEnemy.user_id;
                    appendStatus('vs ' + firstEnemy.username + ' (' + firstEnemy.role + ')', 'info');
                } else {
                    appendStatus('Could not find enemy, waiting...', 'bad');
                }

                // Try setting fast enemy turns
                await apiPost('pvp_battle_action.php', { match_id: matchId, since_log_id: sinceLogId, action: 'set_solo_control_mode', control_mode: 'fast_enemy' });

                // ---- Combat Loop ----
                let matchEnded = false;

                while (isRunning && !matchEnded) {
                    const state = await apiGet('pvp_battle_state.php', { match_id: matchId, since_log_id: sinceLogId });
                    if (state.status === 'error') {
                        await sleep(config.pollInterval);
                        continue;
                    }

                    sinceLogId = state.last_log_id || sinceLogId;

                    if (state.teams?.ally && state.teams?.enemy) {
                        const m = Object.values(state.teams.ally.players_by_num).find(p => String(p.user_id) === String(getCookie('demon'))) || Object.values(state.teams.ally.players_by_num)[0];
                        const e = Object.values(state.teams.enemy.players_by_num)[0];
                        if (m && e) updateHealthUI(m.hp, m.hp_max, e.hp, e.hp_max);
                    }

                    const handleMatchEnd = async (endData) => {
                        matchEnded = true;
                        playChime();
                        const result = endData.winner_side === 'ally' ? 'Win' : 'Loss';
                        setStatus('Match #' + matchId + ' ended: ' + result, result === 'Win' ? 'good' : 'bad');
                        pushHistory(matchId, result, activeMatchState.turnCount, activeMatchState.skillUsage);
                        
                        // Clear active match so we queue next time
                        activeMatchState = { matchId: null, turnCount: 0, skillUsage: {} };
                        await saveActiveMatch();
                    };

                    if (state.match?.ended) {
                        await handleMatchEnd(state.match);
                        break;
                    }

                    if (!state.turn || state.turn.side !== 'ally') {
                        await sleep(config.pollInterval);
                        continue;
                    }

                    // My Turn
                    activeMatchState.turnCount++;
                    const decision = decideSkill(state.me, state.teams);

                    if (!decision.target) {
                        appendStatus('No valid target, waiting...', 'bad');
                        await sleep(config.pollInterval);
                        continue;
                    }

                    const actionResult = await apiPost('pvp_battle_action.php', { match_id: matchId, since_log_id: sinceLogId, action: 'use_skill', skill_id: decision.id, target_key: decision.target });
                    
                    if (actionResult.status !== 'error') {
                        sinceLogId = actionResult.last_log_id || sinceLogId;
                        
                        // Track usage internally
                        activeMatchState.skillUsage[decision.id] = (activeMatchState.skillUsage[decision.id] || 0) + 1;
                        sessionStats.globalSkills[decision.id] = (sessionStats.globalSkills[decision.id] || 0) + 1;
                        saveStats(); // Save async in background
                        renderGlobalSkills();
                        await saveActiveMatch();

                        const skillName = PVP_SKILLS[decision.id]?.name || 'Unknown';
                        appendStatus('T' + activeMatchState.turnCount + ': ' + skillName + ' | ' + decision.reason, 'action');

                        if (actionResult.teams?.enemy) {
                            const updatedE = Object.values(actionResult.teams.enemy.players_by_num)[0];
                            if (updatedE) enemyTargetKey = 'enemy:' + updatedE.user_id;
                        }

                        if (actionResult.match?.ended) {
                            await handleMatchEnd(actionResult.match);
                            break;
                        }
                    } else {
                        appendStatus(actionResult.message || 'Action failed', 'bad');
                    }
                    await sleep(config.pollInterval);
                }

                if (!isRunning) break;

                if (config.autoQueue) {
                    appendStatus('Queuing next match in 3s...', 'info');
                    await sleep(3000);
                } else {
                    setStatus('Auto-queue is off. Stopped.', 'info');
                    document.getElementById('pvp-start-btn').click();
                }

            } catch (err) {
                appendStatus('Loop error: ' + err.message, 'bad');
                await sleep(3000);
            }
        }
    }

    async function initLockManager() {
        let warnBox = null;
        let isStandby = false;

        async function showStandby() {
            if (isStandby) return;
            isStandby = true;
            document.getElementById('pvp-container')?.remove();
            isRunning = false; // Gracefully stop mainLoop if running
            
            const saved = await GM.getValue("veyra_pvp2_config", null);
            const tempConfig = { ...DEFAULT_PVP_CONFIG, ...(saved || {}) };
            if (tempConfig.showStandbyWarning && !warnBox) {
                warnBox = document.createElement('div');
                warnBox.innerHTML = `⚠️ <b>AutoPvP 2.0 Standby</b><br>Another tab is active.`;
                Object.assign(warnBox.style, {
                    position: 'fixed', top: '10px', right: '10px', background: 'rgba(255,150,0,0.9)', 
                    color: 'black', padding: '10px', borderRadius: '6px', zIndex: '999999', 
                    fontFamily: 'monospace', fontSize: '12px', pointerEvents: 'none', boxShadow: '0 4px 10px rgba(0,0,0,0.5)'
                });
                document.body.appendChild(warnBox);
            }
        }

        function hideStandby() {
            if (!isStandby) return;
            isStandby = false;
            if (warnBox) {
                warnBox.remove();
                warnBox = null;
            }
        }

        async function checkLock() {
            let master = await GM.getValue("veyra_pvp2_master", null);
            if (!master) master = { id: '', time: 0 };
            const now = Date.now();

            if (isMaster) {
                if (master.id !== myTabId && master.id !== '') {
                    // Lost lock!
                    isMaster = false;
                    console.warn("AutoPvP 2.0: Lost master lock! Stepping down to standby.");
                    showStandby();
                } else {
                    // Renew lock
                    await GM.setValue("veyra_pvp2_master", { id: myTabId, time: now });
                }
            } else {
                // In standby
                if (now - master.time > 3000 || master.id === myTabId || master.id === '') {
                    // Claimed lock!
                    await GM.setValue("veyra_pvp2_master", { id: myTabId, time: now });
                    isMaster = true;
                    hideStandby();
                    
                    // Boot up app
                    isRunning = await GM.getValue("veyra_pvp2_running", false);
                    await setupUI();
                    if (isRunning) mainLoop();
                } else {
                    showStandby();
                }
            }
        }

        await checkLock(); // Initial check
        setInterval(checkLock, 1000);
    }

    initLockManager();

    } catch (err) {
        const errBox = document.createElement('div');
        Object.assign(errBox.style, {
            position: 'fixed', top: '10px', left: '10px', background: '#ff3333', 
            color: 'white', padding: '15px', borderRadius: '8px', zIndex: '9999999', 
            fontFamily: 'monospace', fontSize: '14px', maxWidth: '80%', boxShadow: '0 4px 10px rgba(0,0,0,0.5)'
        });
        errBox.innerHTML = `<b>AutoPvP 2.0 Fatal Crash:</b><br><br>${err.message}<br><br>${err.stack}`;
        document.body.appendChild(errBox);
        console.error("AutoPvP 2.0 Error:", err);
    }
})();
