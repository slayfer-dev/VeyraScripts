// ==UserScript==
// @name         Auto Farm Bot 4.1
// @namespace    http://tampermonkey.net/
// @version      4.1
// @description  Automates mob selection, combat logic, and batch looting with background auto-loot queue.
// @author       You
// @match        *demonicscans.org/active_wave.php?gate=*&wave=*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(async function() {
    'use strict';

    // =========================================================================
    // --- Constants ---
    // =========================================================================
    const ATTACKS = {
        '0':  { name: "Slash (1 STAMINA)", staminaCost: 1, type: "attack" },
        '-1': { name: "Power Slash (10 STAMINA)", staminaCost: 10, type: "attack" },
        '-2': { name: "Heroic Slash (50 STAMINA)", staminaCost: 50, type: "attack" },
        '-3': { name: "Ultimate Slash (100 STAMINA)", staminaCost: 100, type: "attack" },
        '-4': { name: "Legendary Slash (200 STAMINA)", staminaCost: 200, type: "attack" },
    };
    
    const SKILLS = {
        // Cleric
        '9':  { name: "Judgment Seal", staminaCost: 1, mpCost: 30, type: "attack" },
        '8':  { name: "Heal", staminaCost: 1, mpCost: 20, type: "support" },
        // Hunter
        '6':  { name: "Back Stab", staminaCost: 200, mpCost: 20, type: "attack" },
        '7':  { name: "Killer Instinct", staminaCost: 1, mpCost: 20, type: "support" },
    }

    const WAVES = {
        "gate=3&wave=3": "Gate 3 - Wave 1",
        "gate=3&wave=5": "Gate 3 - Wave 2"
    };

    const MONSTERS = {
        // Wave 1
        "goblin skirmisher": { displayName: "Goblin Skirmisher", wave: 1, img: "images/monsters/monster_689bea482aecd5.59004851.webp" },
        "goblin slinger": { displayName: "Goblin Slinger", wave: 1, img: "images/monsters/monster_689e900b122598.86870107.webp" },
        "orc grunt": { displayName: "Orc Grunt", wave: 1, img: "images/monsters/monster_689e9049f06a39.75621837.webp" },
        "orc bonecrusher": { displayName: "Orc Bonecrusher", wave: 1, img: "images/monsters/monster_689e9075bed4e6.67265953.webp" },
        "hobgoblin spearman": { displayName: "Hobgoblin Spearman", wave: 1, img: "images/monsters/monster_689e90c0d497d8.56568541.webp" },
        // Wave 2
        "troll ravager": { displayName: "Troll Ravager", wave: 2, img: "images/monsters/monster_689e90e9ae1b88.40735056.webp" },
        "lizardman flamecaster": { displayName: "Lizardman Flamecaster", wave: 2, img: "images/monsters/monster_689e913ecffac3.17663892.webp" },
        "troll brawler": { displayName: "Troll Brawler", wave: 2, img: "images/monsters/monster_689e9180028033.05347656.webp" },
        "lizardman shadowclaw": { displayName: "Lizardman Shadowclaw", wave: 2, img: "images/monsters/monster_689e91b2965a08.22765337.webp" },
        // Wave 3 pending...
    };

    const DEFAULT_CONFIG = {
        enabled: false,
        dmgThreshold: 75000,
        skillId: '0',
        priority: 10,
        autoLoot: false,
    };

    // =========================================================================
    // --- State & Config ---
    // =========================================================================
    let userConfig = GM_getValue("veyra_autofarm_config", {});
    let activeWavesConfig = GM_getValue("veyra_autofarm_waves", Object.keys(WAVES));
    let allowSupportSpam = GM_getValue("veyra_autofarm_allow_support", false);
    let sessionStats = GM_getValue("veyra_autofarm_stats", {
        kills: 0,
        staminaUsed: 0,
        monstersKilled: {}
    });

    let isRunning = GM_getValue("veyra_autofarm_running", false);
    let isLooting = false; // Background batch looting state
    let activeTab = "farm"; // "farm" or "loot"

    // Data structures holding the fetched monsters
    let liveMonsters = {}; // Farm tab (alive)
    let deadMonsters = {}; // Loot tab (dead)

    // Background Auto-Loot Queue
    let pendingLootQueue = new Map(); // id -> dataName

    let currentLoopTimeout = null;

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const randomDelay = (min, max) => sleep(Math.floor(Math.random() * (max - min + 1)) + min);

    function getCookie(name) {
        const value = '; ' + document.cookie;
        const parts = value.split('; ' + name + '=');
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }

    function saveStats() {
        GM_setValue("veyra_autofarm_stats", sessionStats);
    }

    function saveMonsterConfig(monsterName, key, value) {
        if (!userConfig[monsterName]) userConfig[monsterName] = { ...DEFAULT_CONFIG };
        userConfig[monsterName][key] = value;
        GM_setValue("veyra_autofarm_config", userConfig);
    }

    // =========================================================================
    // --- UI Setup ---
    // =========================================================================
    function setupUI() {
        const savedUI = GM_getValue("veyra_autofarm_ui", {
            left: 'calc(100vw - 600px)',
            top: '50px',
            width: '500px',
            height: 'auto',
            minimized: false
        });

        const css = `
        #afb-container {
            position: fixed;
            top: ${savedUI.top};
            left: ${savedUI.left};
            width: ${savedUI.width};
            height: ${savedUI.height};
            max-height: 85vh;
            min-width: 380px;
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
        #afb-header {
            background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
            padding: 10px 14px;
            cursor: grab;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #334155;
            user-select: none;
        }
        #afb-header:active { cursor: grabbing; }
        #afb-title { font-weight: bold; font-size: 15px; display: flex; gap: 8px; align-items: center; }
        #afb-toggle-minimize {
            background: none; border: none; color: #94a3b8; cursor: pointer;
            font-size: 18px; line-height: 1; padding: 0 4px;
        }
        #afb-toggle-minimize:hover { color: white; }

        #afb-content {
            display: flex;
            flex-direction: column;
            overflow: hidden;
            flex-grow: 1;
        }

        .afb-minimized { height: auto !important; min-height: 0 !important; padding-bottom: 0 !important; resize: none !important; }
        .afb-minimized #afb-content { display: none; }

        #afb-global-controls {
            padding: 10px 14px; background: #1e293b; border-bottom: 1px solid #334155;
        }

        .afb-tabs {
            display: flex; background: #0f172a; border-bottom: 1px solid #334155;
        }
        .afb-tab-btn {
            flex: 1; padding: 10px; background: none; border: none; color: #94a3b8;
            cursor: pointer; font-weight: bold; text-align: center; font-size: 13px;
        }
        .afb-tab-btn:hover { color: white; background: rgba(255,255,255,0.05); }
        .afb-tab-btn.active { color: #3b82f6; border-bottom: 2px solid #3b82f6; background: rgba(59, 130, 246, 0.1); }

        .afb-tab-content { display: none; flex-direction: column; padding: 12px; overflow-y: auto; flex-grow: 1; gap: 12px; }
        .afb-tab-content.active { display: flex; }

        .afb-section {
            background: #1e293b; border: 1px solid #334155; border-radius: 6px; padding: 10px;
        }
        .afb-section-title {
            font-weight: bold; font-size: 11px; text-transform: uppercase;
            letter-spacing: 0.5px; color: #94a3b8; margin-bottom: 8px;
        }

        .afb-status-box {
            background: #0f172a; border: 1px solid #334155; border-radius: 4px; padding: 8px;
            font-size: 11px; color: #94a3b8; height: 60px; min-height: 40px; max-height: 200px;
            overflow-y: auto; resize: vertical; line-height: 1.6; word-wrap: break-word;
        }
        .afb-status-line { margin: 0; }
        .afb-status-action { color: #60a5fa; }
        .afb-status-good { color: #4ade80; }
        .afb-status-bad { color: #f87171; }
        .afb-status-info { color: #fbbf24; }

        .afb-stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; text-align: center; }
        .afb-stat-item { background: #0f172a; border-radius: 4px; padding: 6px 4px; }
        .afb-stat-value { font-size: 18px; font-weight: bold; color: white; }
        .afb-stat-label { font-size: 10px; color: #64748b; text-transform: uppercase; }

        .afb-btn { padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px; transition: background 0.2s; color: white; }
        .afb-btn-primary { background: #3b82f6; }
        .afb-btn-primary:hover { background: #2563eb; }
        .afb-btn-stop { background: #ef4444; }
        .afb-btn-stop:hover { background: #dc2626; }
        .afb-btn-dark { background: #334155; }
        .afb-btn-dark:hover { background: #475569; }

        .afb-wave-header { font-weight: bold; font-size: 14px; color: #cbd5e1; margin-top: 10px; margin-bottom: 8px; display: flex; align-items: center; }
        .afb-wave-header hr { flex-grow: 1; border: none; border-top: 1px solid #334155; margin-left: 10px; }

        .afb-monster-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; }
        .afb-monster-card { background: #0f172a; border-radius: 6px; padding: 8px; border: 1px solid #475569; display: flex; flex-direction: column; gap: 6px; }
        .afb-monster-header { display: flex; align-items: center; gap: 8px; }
        .afb-monster-header img { width: 32px; height: 32px; border-radius: 4px; object-fit: cover; }
        .afb-monster-header span { flex-grow: 1; font-weight: bold; font-size: 12px; }
        .afb-controls-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
        .afb-input-group { display: flex; flex-direction: column; gap: 2px; }
        .afb-input-group label { font-size: 10px; color: #94a3b8; }
        .afb-input-group input, .afb-input-group select { background: #1e293b; border: 1px solid #334155; color: white; padding: 4px; border-radius: 4px; font-size: 11px; width: 100%; box-sizing: border-box; }

        /* Loot specific UI */
        .afb-loot-card { display: flex; align-items: center; gap: 8px; padding: 6px; background: #0f172a; border-radius: 6px; border: 1px solid #475569; }
        .afb-loot-card span { flex-grow: 1; font-size: 12px; }
        .afb-loot-card span.afb-loot-count { color: #facc15; font-weight: bold; }
        .afb-loot-actions { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; align-items: center; }
        .afb-loot-actions select, .afb-loot-actions input { background: #0f172a; border: 1px solid #475569; color: white; padding: 5px; border-radius: 4px; font-size: 12px; }
        `;
        GM_addStyle(css);

        const container = document.createElement('div');
        container.id = 'afb-container';
        if (savedUI.minimized) container.classList.add('afb-minimized');

        container.innerHTML = `
            <div id="afb-header">
                <div id="afb-title">⚔️ AutoFarm 4.1</div>
                <button id="afb-toggle-minimize">${savedUI.minimized ? '+' : '\u2014'}</button>
            </div>

            <div id="afb-content">
                <!-- GLOBAL CONTROLS -->
                <div id="afb-global-controls">
                    <div style="font-weight:bold; font-size:12px; margin-bottom:6px; color:#cbd5e1;">Target Waves:</div>
                    <div id="afb-wave-checkboxes" style="display:flex; gap:12px; flex-wrap:wrap; font-size:12px;">
                        ${Object.entries(WAVES).map(([waveQuery, waveName]) =>
                            `<label style="cursor:pointer;"><input type="checkbox" class="afb-wave-cb" value="${waveQuery}" ${activeWavesConfig.includes(waveQuery) ? 'checked' : ''}> ${waveName}</label>`
                        ).join('')}
                    </div>
                </div>

                <div class="afb-tabs">
                    <button class="afb-tab-btn active" data-tab="farm">Farm</button>
                    <button class="afb-tab-btn" data-tab="loot">Loot</button>
                </div>

                <!-- FARM TAB -->
                <div id="afb-tab-farm" class="afb-tab-content active">
                    <div class="afb-section" style="display:flex; gap:10px; align-items:center;">
                        <button id="afb-start-btn" class="afb-btn ${isRunning ? 'afb-btn-stop' : 'afb-btn-primary'}" style="flex:1;">${isRunning ? 'Stop Farming' : 'Start Farming'}</button>
                        <div style="font-size:12px; display:flex; gap:10px; align-items:center;">
                            <label style="cursor:pointer;"><input type="checkbox" id="afb-allow-support" ${allowSupportSpam ? 'checked' : ''}> Support Skills</label>
                            <button id="afb-scan-btn" class="afb-btn afb-btn-dark" style="padding:4px 8px;">Scan Alive</button>
                        </div>
                    </div>

                    <div class="afb-section">
                        <div class="afb-section-title">Session Stats</div>
                        <div class="afb-stats-grid">
                            <div class="afb-stat-item"><div class="afb-stat-value" id="afb-stat-stamina">0</div><div class="afb-stat-label">Stamina Used</div></div>
                            <div class="afb-stat-item"><div class="afb-stat-value" id="afb-stat-kills" style="color:#4ade80">0</div><div class="afb-stat-label">Total Kills</div></div>
                        </div>
                        <div id="afb-kill-breakdown" style="font-size: 11px; color: #94a3b8; margin-top: 6px;"></div>
                        <button id="afb-clear-stats-btn" class="afb-btn afb-btn-dark" style="margin-top: 8px; width: 100%; padding: 4px; font-size: 11px;">Clear Farm History</button>
                    </div>

                    <div class="afb-section">
                        <div class="afb-section-title">Farm Status</div>
                        <div id="afb-farm-status" class="afb-status-box">Idle.</div>
                    </div>

                    <div id="afb-farm-monsters">Loading monsters...</div>
                </div>

                <!-- LOOT TAB -->
                <div id="afb-tab-loot" class="afb-tab-content">
                    <div class="afb-section">
                        <div class="afb-section-title">Batch Loot Controls</div>
                        <div class="afb-loot-actions">
                            <button id="afb-loot-all" class="afb-btn afb-btn-primary">Loot All Dead</button>
                            <button id="afb-loot-amount" class="afb-btn afb-btn-primary">Loot N</button>
                            <input type="number" id="afb-loot-amount-val" value="10" style="width:50px;">
                        </div>
                        <div class="afb-section-title" style="margin-top:10px;">Loot Specific Kind</div>
                        <div class="afb-loot-actions">
                            <select id="afb-loot-kind-sel" style="flex:1; max-width:140px;">
                                <option value="">Loading...</option>
                            </select>
                            <button id="afb-loot-kind-all" class="afb-btn afb-btn-primary">Loot All</button>
                            <button id="afb-loot-kind-amount" class="afb-btn afb-btn-primary">Loot N</button>
                            <input type="number" id="afb-loot-kind-amount-val" value="5" style="width:50px;">
                        </div>
                        <button id="afb-scan-loot-btn" class="afb-btn afb-btn-dark" style="margin-top:8px; width:100%;">Scan Dead Monsters</button>
                    </div>

                    <div class="afb-section">
                        <div class="afb-section-title">Loot Status</div>
                        <div id="afb-loot-status" class="afb-status-box">Ready. Press Scan to fetch dead monsters.</div>
                    </div>

                    <div id="afb-loot-monsters">Loading dead monsters...</div>
                </div>
            </div>
        `;
        document.body.appendChild(container);

        // Resize Observer
        const resizeObserver = new ResizeObserver(entries => {
            if (!isDragging) {
                savedUI.width = container.style.width || `${container.offsetWidth}px`;
                savedUI.height = container.style.height || `${container.offsetHeight}px`;
                GM_setValue("veyra_autofarm_ui", savedUI);
            }
        });
        resizeObserver.observe(container);

        // Dragging Logic
        const header = document.getElementById('afb-header');
        let isDragging = false, startX, startY, initialX, initialY;
        header.addEventListener('mousedown', e => {
            if (e.target.id === 'afb-toggle-minimize') return;
            isDragging = true;
            startX = e.clientX; startY = e.clientY;
            initialX = container.offsetLeft; initialY = container.offsetTop;
        });
        document.addEventListener('mousemove', e => {
            if (!isDragging) return;
            container.style.left = `${initialX + e.clientX - startX}px`;
            container.style.top = `${initialY + e.clientY - startY}px`;
            container.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                savedUI.left = container.style.left;
                savedUI.top = container.style.top;
                GM_setValue("veyra_autofarm_ui", savedUI);
            }
        });

        // Minimize
        const minBtn = document.getElementById('afb-toggle-minimize');
        minBtn.addEventListener('click', () => {
            container.classList.toggle('afb-minimized');
            savedUI.minimized = container.classList.contains('afb-minimized');
            minBtn.innerText = savedUI.minimized ? '+' : '\u2014';
            GM_setValue("veyra_autofarm_ui", savedUI);
        });

        // Global Wave Checkboxes
        document.querySelectorAll('.afb-wave-cb').forEach(cb => {
            cb.addEventListener('change', () => {
                activeWavesConfig = Array.from(document.querySelectorAll('.afb-wave-cb:checked')).map(el => el.value);
                GM_setValue("veyra_autofarm_waves", activeWavesConfig);
                if (activeTab === 'farm' && !isRunning) prefetchWaves('alive');
                else if (activeTab === 'loot') prefetchWaves('dead');
            });
        });

        // Tabs
        let lootTabScannedOnce = false;
        document.querySelectorAll('.afb-tab-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                document.querySelectorAll('.afb-tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.afb-tab-content').forEach(c => c.classList.remove('active'));

                e.target.classList.add('active');
                activeTab = e.target.dataset.tab;
                document.getElementById(`afb-tab-${activeTab}`).classList.add('active');

                if (activeTab === 'loot' && !lootTabScannedOnce) {
                    lootTabScannedOnce = true;
                    appendStatus(`Scanning dead monsters for the first time...`, 'info', 'afb-loot-status');
                    await prefetchWaves('dead');
                }
            });
        });

        // Farm Controls
        document.getElementById('afb-start-btn').addEventListener('click', (e) => {
            isRunning = !isRunning;
            GM_setValue("veyra_autofarm_running", isRunning);
            e.target.innerText = isRunning ? "Stop Farming" : "Start Farming";
            e.target.className = isRunning ? "afb-btn afb-btn-stop" : "afb-btn afb-btn-primary";
            if (isRunning) {
                loop();
            } else {
                if (currentLoopTimeout) clearTimeout(currentLoopTimeout);
            }
        });

        document.getElementById('afb-scan-btn').addEventListener('click', () => {
            prefetchWaves('alive');
        });

        document.getElementById('afb-allow-support').addEventListener('change', (e) => {
            allowSupportSpam = e.target.checked;
            GM_setValue("veyra_autofarm_allow_support", allowSupportSpam);
            renderFarmMonsters(); // re-render dropdowns
        });

        document.getElementById('afb-clear-stats-btn').addEventListener('click', () => {
            sessionStats = { kills: 0, staminaUsed: 0, monstersKilled: {} };
            saveStats();
            updateStatsUI();
        });

        // Loot Controls
        document.getElementById('afb-scan-loot-btn').addEventListener('click', () => prefetchWaves('dead'));
        document.getElementById('afb-loot-all').addEventListener('click', () => doBatchLoot('all'));
        document.getElementById('afb-loot-amount').addEventListener('click', () => doBatchLoot('amount', parseInt(document.getElementById('afb-loot-amount-val').value)));
        document.getElementById('afb-loot-kind-all').addEventListener('click', () => doBatchLoot('kind_all', document.getElementById('afb-loot-kind-sel').value));
        document.getElementById('afb-loot-kind-amount').addEventListener('click', () => doBatchLoot('kind_amount', document.getElementById('afb-loot-kind-sel').value, parseInt(document.getElementById('afb-loot-kind-amount-val').value)));
    }

    // =========================================================================
    // --- Status & Stats Helpers ---
    // =========================================================================
    function appendStatus(text, cssClass, targetBox = null) {
        const boxId = targetBox || 'afb-farm-status';
        const box = document.getElementById(boxId);
        if (!box) return;

        const lines = box.querySelectorAll('.afb-status-line');
        if (lines.length >= 8) lines[0].remove();

        const p = document.createElement('p');
        p.className = 'afb-status-line' + (cssClass ? ' afb-status-' + cssClass : '');
        p.textContent = text;
        box.appendChild(p);
        box.scrollTop = box.scrollHeight;
    }

    function updateStatsUI() {
        document.getElementById('afb-stat-stamina').textContent = sessionStats.staminaUsed;
        document.getElementById('afb-stat-kills').textContent = sessionStats.kills;

        const breakdownEl = document.getElementById('afb-kill-breakdown');
        const parts = Object.entries(sessionStats.monstersKilled).map(([dataName, count]) => {
            const name = MONSTERS[dataName]?.displayName || dataName;
            return `${name}: <span style="color:#e2e8f0">${count}</span>`;
        });
        breakdownEl.innerHTML = parts.length > 0 ? parts.join(' &middot; ') : '';
    }

    function trackKill(dataName) {
        sessionStats.kills++;
        if (!sessionStats.monstersKilled[dataName]) sessionStats.monstersKilled[dataName] = 0;
        sessionStats.monstersKilled[dataName]++;
        saveStats();
        updateStatsUI();
    }

    function trackStamina(amount) {
        sessionStats.staminaUsed += amount;
        saveStats();
        updateStatsUI();
    }

    // =========================================================================
    // --- UI Renderers ---
    // =========================================================================
    function renderFarmMonsters() {
        const container = document.getElementById('afb-farm-monsters');
        container.innerHTML = '';
        let foundAny = false;

        const skillsOptions = Object.entries(ATTACKS)
            .filter(([, s]) => s.type === 'attack' || (allowSupportSpam && s.type === 'support'))
            .map(([sId, s]) => `<option value="${sId}">${s.name} (Cost: ${s.staminaCost})</option>`);

        for (const [waveQuery, waveName] of Object.entries(WAVES)) {
            const waveGroup = liveMonsters[waveQuery];
            if (!waveGroup || Object.keys(waveGroup).length === 0) continue;
            foundAny = true;

            const header = document.createElement('div');
            header.className = 'afb-wave-header';
            header.innerHTML = `${waveName} <hr>`;
            container.appendChild(header);

            const grid = document.createElement('div');
            grid.className = 'afb-monster-grid';

            for (const [dataName, m] of Object.entries(waveGroup)) {
                const conf = userConfig[dataName] || { ...DEFAULT_CONFIG };
                const card = document.createElement('div');
                card.className = 'afb-monster-card';

                let specificSkillOpts = skillsOptions.map(opt => {
                    const isSelected = opt.includes(`value="${conf.skillId}"`);
                    return isSelected ? opt.replace('value="', 'selected value="') : opt;
                }).join('');

                card.innerHTML = `
                    <div class="afb-monster-header">
                        <img src="${m.img}" alt="img">
                        <span>${m.name}</span>
                        <input type="checkbox" class="afb-m-enable" data-id="${dataName}" ${conf.enabled ? 'checked' : ''} title="Enable farming">
                    </div>
                    <div class="afb-controls-grid">
                        <div class="afb-input-group">
                            <label>Threshold</label>
                            <input type="number" class="afb-m-thresh" data-id="${dataName}" value="${conf.dmgThreshold}">
                        </div>
                        <div class="afb-input-group">
                            <label>Priority</label>
                            <input type="number" class="afb-m-prio" data-id="${dataName}" value="${conf.priority}">
                        </div>
                        <div class="afb-input-group" style="grid-column: span 2;">
                            <label>Skill</label>
                            <select class="afb-m-skill" data-id="${dataName}">${specificSkillOpts}</select>
                        </div>
                        <div class="afb-input-group" style="grid-column: span 2; flex-direction:row; align-items:center; gap:5px; margin-top:2px;">
                            <input type="checkbox" class="afb-m-autoloot" data-id="${dataName}" ${conf.autoLoot ? 'checked' : ''}>
                            <label style="color:#facc15; font-weight:bold;">Auto Loot (Queued)</label>
                        </div>
                    </div>
                `;
                grid.appendChild(card);
            }
            container.appendChild(grid);
        }

        if (!foundAny) {
            container.innerHTML = '<div style="font-size:12px; color:#94a3b8; padding-top:10px;">No alive monsters found in active waves.</div>';
        }

        // Attach events
        document.querySelectorAll('.afb-m-enable').forEach(el => el.addEventListener('change', e => saveMonsterConfig(e.target.dataset.id, 'enabled', e.target.checked)));
        document.querySelectorAll('.afb-m-thresh').forEach(el => el.addEventListener('change', e => saveMonsterConfig(e.target.dataset.id, 'dmgThreshold', Number(e.target.value))));
        document.querySelectorAll('.afb-m-prio').forEach(el => el.addEventListener('change', e => saveMonsterConfig(e.target.dataset.id, 'priority', Number(e.target.value))));
        document.querySelectorAll('.afb-m-skill').forEach(el => el.addEventListener('change', e => saveMonsterConfig(e.target.dataset.id, 'skillId', String(e.target.value))));
        document.querySelectorAll('.afb-m-autoloot').forEach(el => el.addEventListener('change', e => saveMonsterConfig(e.target.dataset.id, 'autoLoot', e.target.checked)));
    }

    function renderLootMonsters() {
        const container = document.getElementById('afb-loot-monsters');
        const kindSelect = document.getElementById('afb-loot-kind-sel');
        container.innerHTML = '';
        kindSelect.innerHTML = '<option value="">-- Select Kind --</option>';

        let foundAny = false;
        let kindsSeen = new Set();

        for (const [waveQuery, waveName] of Object.entries(WAVES)) {
            const waveGroup = deadMonsters[waveQuery];
            if (!waveGroup || Object.keys(waveGroup).length === 0) continue;
            foundAny = true;

            const header = document.createElement('div');
            header.className = 'afb-wave-header';
            header.innerHTML = `${waveName} <hr>`;
            container.appendChild(header);

            const grid = document.createElement('div');
            grid.className = 'afb-monster-grid';

            for (const [dataName, m] of Object.entries(waveGroup)) {
                if (!kindsSeen.has(dataName)) {
                    kindsSeen.add(dataName);
                    kindSelect.innerHTML += `<option value="${dataName}">${m.name} (${m.ids.length})</option>`;
                }

                const conf = userConfig[dataName] || { ...DEFAULT_CONFIG };
                const card = document.createElement('div');
                card.className = 'afb-loot-card';
                card.innerHTML = `
                    <img src="${m.img}" alt="img" style="width:32px; height:32px; border-radius:4px; object-fit:cover;">
                    <span>${m.name}</span>
                    <span class="afb-loot-count">x${m.ids.length}</span>
                    <input type="checkbox" class="afb-m-autoloot-loot" data-id="${dataName}" ${conf.autoLoot ? 'checked' : ''} title="Auto Loot">
                `;
                grid.appendChild(card);
            }
            container.appendChild(grid);
        }

        if (!foundAny) {
            container.innerHTML = '<div style="font-size:12px; color:#94a3b8; padding-top:10px;">No dead monsters found to loot.</div>';
        }

        // Sync auto-loot checkboxes between tabs
        document.querySelectorAll('.afb-m-autoloot-loot').forEach(el => {
            el.addEventListener('change', e => {
                saveMonsterConfig(e.target.dataset.id, 'autoLoot', e.target.checked);
                renderFarmMonsters(); // Keep farm tab synced
            });
        });
    }

    // =========================================================================
    // --- API & Fetching ---
    // =========================================================================
    async function prefetchWaves(mode = 'alive') {
        const isFarm = (mode === 'alive');

        // Force cookie for alive(1) vs dead(0)
        document.cookie = `hide_dead_monsters=${isFarm ? '1' : '0'}; path=/`;

        let tempMonsters = {};

        for (const waveQuery of activeWavesConfig) {
            tempMonsters[waveQuery] = {};
            try {
                const html = await fetch(`https://demonicscans.org/active_wave.php?${waveQuery}`).then(r => r.text());
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');

                const cards = doc.querySelectorAll(".monster-container .monster-card");
                cards.forEach(card => {
                    const id = card.dataset.monsterId;
                    const dataName = card.dataset.name;
                    if (!id || !dataName) return;

                    const name = card.querySelector(".monster-name")?.innerText.trim() || MONSTERS[dataName]?.displayName || dataName;
                    const img = card.querySelector(".monster-image-class")?.src || card.querySelector("img")?.src || MONSTERS[dataName]?.img || '';

                    if (!tempMonsters[waveQuery][dataName]) {
                        tempMonsters[waveQuery][dataName] = { dataName, name, img, ids: [] };
                    }
                    tempMonsters[waveQuery][dataName].ids.push({ id });
                });
            } catch (e) {
                console.error("Error prefetching wave:", waveQuery, e);
            }
        }

        if (isFarm) {
            liveMonsters = tempMonsters;
            // Only re-render if user is on Farm tab so we don't clobber DOM needlessly
            if (activeTab === 'farm') renderFarmMonsters();
        } else {
            deadMonsters = tempMonsters;
            if (activeTab === 'loot') renderLootMonsters();
        }
    }

    async function prefetchTargetStats(enemyId) {
        try {
            const html = await fetch(`https://demonicscans.org/battle.php?id=${enemyId}`).then(r => r.text());
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const hpEl = doc.querySelector('#hpText');
            const dmgEl = doc.querySelector('#yourDamageValue');
            const staminaEl = doc.querySelector('#staminaText');

            return {
                hp: hpEl ? Number(hpEl.innerText.replaceAll(/[\\.,]/g, '')) : null,
                dmg: dmgEl ? Number(dmgEl.innerText.replaceAll(/[\\.,]/g, '')) : 0,
                currentStamina: staminaEl ? Number(staminaEl.innerText) : 999
            };
        } catch (e) {
            return { hp: null, dmg: 0, currentStamina: 0 };
        }
    }

    async function joinBattle(enemyId) {
        for (let j = 0; j < 3; j++) {
            try {
                const demonCookie = getCookie("demon");
                let uIdStr = demonCookie ? `&user_id=${demonCookie}` : "";

                const result = await fetch("https://demonicscans.org/user_join_battle.php", {
                    "headers": { "content-type": "application/x-www-form-urlencoded" },
                    "referrer": `https://demonicscans.org/battle.php?id=${enemyId}`,
                    "body": `monster_id=${enemyId}${uIdStr}`,
                    "method": "POST",
                    "mode": "cors",
                    "credentials": "include"
                }).then(i => i.text());

                if (result.includes("You are already part of this battle.") || result.includes("successfully joined")) return true;
                if (result.includes("Invalid monster.")) return false;

                await randomDelay(1000, 1100);
            } catch (e) {
                await randomDelay(1000, 1100);
            }
        }
        return false;
    }

    async function apiLoot(monsterId) {
        try {
            const demonCookie = getCookie("demon");
            if (!demonCookie) return { success: false, text: "No user id" };

            const res = await fetch("https://demonicscans.org/loot.php", {
                "headers": { "content-type": "application/x-www-form-urlencoded" },
                "referrer": `https://demonicscans.org/battle.php?id=${monsterId}`,
                "body": `monster_id=${monsterId}&user_id=${demonCookie}`,
                "method": "POST",
                "mode": "cors",
                "credentials": "include"
            });
            const text = await res.text();
            return { success: res.ok, text: text.toLowerCase() };
        } catch(e) {
            return { success: false, text: e.message };
        }
    }

    // =========================================================================
    // --- Auto-Loot Watcher ---
    // =========================================================================
    async function autoLootWatcher() {
        while(true) {
            await sleep(15000); // Check every 15s
            if (pendingLootQueue.size === 0) continue;

            for (const [mId, dataName] of pendingLootQueue.entries()) {
                const res = await apiLoot(mId);
                // Remove if success or explicitly stated it was looted/already dead
                if (res.success || res.text.includes('already') || res.text.includes('looted') || res.text.includes('success')) {
                    pendingLootQueue.delete(mId);
                    appendStatus(`Queue looted: ${MONSTERS[dataName]?.displayName || dataName}`, 'good', 'afb-farm-status');
                }
                await randomDelay(1000, 1100); // small delay between checks
            }
        }
    }

    // =========================================================================
    // --- Combat Logic ---
    // =========================================================================
    async function attackEnemy(enemyId, dataName) {
        const conf = userConfig[dataName] || DEFAULT_CONFIG;
        const skill = ATTACKS[conf.skillId] || ATTACKS['0'];

        let stats = await prefetchTargetStats(enemyId);

        // --- STAMINA CHECK BEFORE JOINING ---
        if (stats.currentStamina < skill.staminaCost) {
            appendStatus(`Skipping ${dataName}: Not enough stamina (${stats.currentStamina}/${skill.staminaCost})`, 'bad');
            return null;
        }

        // Safety checks
        if (stats.hp === null || stats.hp < conf.dmgThreshold * 2) {
            return null;
        }
        if (stats.dmg >= conf.dmgThreshold) {
            return { action: 'threshold' }; // Reached threshold from previous attacks
        }

        const joined = await joinBattle(enemyId);
        if (!joined) return null;

        while (isRunning) {
            if (stats.currentStamina < skill.staminaCost) {
                appendStatus(`Out of stamina for ${dataName}`, 'bad');
                return null;
            }

            try {
                const result = await fetch("https://demonicscans.org/damage.php", {
                    "headers": { "content-type": "application/x-www-form-urlencoded" },
                    "referrer": `https://demonicscans.org/battle.php?id=${enemyId}`,
                    "body": `monster_id=${enemyId}&skill_id=${conf.skillId}&stamina_cost=${skill.staminaCost}`,
                    "method": "POST",
                    "mode": "cors",
                    "credentials": "include"
                }).then(i => i.json());

                if (result.status === "error") {
                    if (result.message?.includes("Monster is already dead.")) {
                        trackKill(dataName);
                        return { action: 'dead' };
                    }
                    if (result.message?.includes("inactivity")) { await joinBattle(enemyId); continue; }
                    if (result.message?.includes("Not enough stamina.")) return null;
                    await randomDelay(1000, 1100);
                    continue;
                }

                // Hit successful, track stamina
                trackStamina(skill.staminaCost);

                // Check end conditions
                if (result.hp?.value <= 0) {
                    trackKill(dataName);
                    return { action: 'dead' };
                }

                if (result.totaldmgdealt >= conf.dmgThreshold) return { action: 'threshold' };
                if (result.hp?.value <= (conf.dmgThreshold * 2)) return { action: 'threshold' }; // Safety margin
                if (result.stamina < skill.staminaCost) return null;

                await randomDelay(1000, 1100);
                stats.currentStamina = result.stamina;

            } catch (e) {
                await randomDelay(1000, 1100);
            }
        }
        return null;
    }

    async function loop() {
        if (!isRunning) return;

        appendStatus("Scanning alive waves...", 'info');
        await prefetchWaves('alive'); // Fetches alive monsters into liveMonsters

        // Flatten and sort active monsters by priority
        let targetInstances = [];
        for (const waveQuery of activeWavesConfig) {
            const waveGroup = liveMonsters[waveQuery];
            if (!waveGroup) continue;

            for (const [dataName, m] of Object.entries(waveGroup)) {
                const conf = userConfig[dataName] || DEFAULT_CONFIG;
                if (!conf.enabled) continue;

                const prio = conf.priority ?? 10;
                for (const inst of m.ids) {
                    targetInstances.push({ id: inst.id, dataName: dataName, priority: prio });
                }
            }
        }

        targetInstances.sort((a, b) => a.priority - b.priority);

        for (const target of targetInstances) {
            if (!isRunning) break;
            appendStatus(`Attacking ${MONSTERS[target.dataName]?.displayName || target.dataName}`, 'action');

            const result = await attackEnemy(target.id, target.dataName);
            const conf = userConfig[target.dataName] || DEFAULT_CONFIG;

            if (result && result.action === 'dead') {
                if (conf.autoLoot) {
                    appendStatus(`Auto-looting ${target.dataName}`, 'good', 'afb-farm-status');
                    await apiLoot(target.id);
                }
            } else if (result && result.action === 'threshold') {
                if (conf.autoLoot) {
                    if (!pendingLootQueue.has(target.id)) {
                        appendStatus(`Queued ${target.dataName} for auto-loot watcher`, 'info', 'afb-farm-status');
                        pendingLootQueue.set(target.id, target.dataName);
                    }
                }
            }

            await randomDelay(1000, 1100);
        }

        if (isRunning) {
            currentLoopTimeout = setTimeout(loop, 5000);
        }
    }

    // =========================================================================
    // --- Batch Looting Logic ---
    // =========================================================================
    async function doBatchLoot(mode, kindOrAmount = null, specificAmount = null) {
        if (isLooting) {
            appendStatus("Already looting in background...", 'bad', 'afb-loot-status');
            return;
        }

        isLooting = true;
        appendStatus("Executing batch loot...", 'info', 'afb-loot-status');

        let toLoot = [];
        for (const waveGroup of Object.values(deadMonsters)) {
            for (const [dataName, m] of Object.entries(waveGroup)) {
                for (const inst of m.ids) {
                    toLoot.push({ id: inst.id, dataName: dataName });
                }
            }
        }

        if (mode === 'kind_all' || mode === 'kind_amount') {
            const targetKind = kindOrAmount;
            if (!targetKind) {
                appendStatus("Please select a kind first.", 'bad', 'afb-loot-status');
                isLooting = false; return;
            }
            toLoot = toLoot.filter(item => item.dataName === targetKind);
        }

        let amountLimit = toLoot.length;
        if (mode === 'amount') amountLimit = kindOrAmount;
        if (mode === 'kind_amount') amountLimit = specificAmount;

        toLoot = toLoot.slice(0, amountLimit);

        if (toLoot.length === 0) {
            appendStatus("No monsters match criteria.", 'info', 'afb-loot-status');
            isLooting = false; return;
        }

        appendStatus(`Looting ${toLoot.length} monster(s)...`, 'action', 'afb-loot-status');

        let successCount = 0;
        for (let i = 0; i < toLoot.length; i++) {
            if (!isLooting) break; // if user aborted somehow
            const target = toLoot[i];
            const res = await apiLoot(target.id);
            if (res.success || res.text.includes('already') || res.text.includes('success')) {
                successCount++;
            }
            await randomDelay(1000,1100); // delay between loots
        }

        appendStatus(`Finished looting. Success/Skipped: ${successCount}/${toLoot.length}`, 'good', 'afb-loot-status');
        isLooting = false;

        // Refresh view
        await prefetchWaves('dead');
    }

    // =========================================================================
    // --- Initialize (Multi-Tab Safety) ---
    // =========================================================================
    let isMaster = false;
    const bc = new BroadcastChannel('veyra_autofarm_channel');

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
        overlay.innerHTML = '⚔️ <b>AutoFarm</b>: Already running on another tab.';
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
        console.log("AutoFarm disabled: Master lock held by another tab.");
    } else {
        isMaster = true;
        setupUI();
        updateStatsUI();
        prefetchWaves('alive');

        autoLootWatcher();
        if (isRunning) loop();
    }

})();
