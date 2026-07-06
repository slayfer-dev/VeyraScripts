// ==UserScript==
// @name         AutoFarm 2.0
// @namespace    https://demonicscans.org/scripts/
// @version      2.1
// @description  Automates mob farming, batch looting, and potion management with premium UI, history tracking, and multi-tab safety.
// @author       Slayfer
// @match        *demonicscans.org/active_wave.php?gate=*&wave=*
// @grant        GM.getValue
// @grant        GM.setValue
// ==/UserScript==

(async function () {
    'use strict';
    try {

    // =========================================================================
    // --- Constants ---
    // =========================================================================
    const ATTACKS = {
        '0':  { name: "Slash", staminaCost: 1, type: "attack" },
        '-1': { name: "Power Slash", staminaCost: 10, type: "attack" },
        '-2': { name: "Heroic Slash", staminaCost: 50, type: "attack" },
        '-3': { name: "Ultimate Slash", staminaCost: 100, type: "attack" },
        '-4': { name: "Legendary Slash", staminaCost: 200, type: "attack" },
    };

    const SKILLS = {
        // Cleric
        '9':  { name: "Judgment Seal", staminaCost: 1, mpCost: 30, type: "attack" },
        '8':  { name: "Heal", staminaCost: 1, mpCost: 20, type: "support" },
        // Hunter
        '6':  { name: "Back Stab", staminaCost: 200, mpCost: 20, type: "attack" },
        '7':  { name: "Killer Instinct", staminaCost: 1, mpCost: 20, type: "support" },
    };

    const WAVES = {
        "gate=3&wave=3": { name: "Gate 3 - Wave 1", wave: 1 },
        "gate=3&wave=5": { name: "Gate 3 - Wave 2", wave: 2 },
        // Wave 3 pending...
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

    const POTIONS = {
        fullStamina:  { invId: '1043176805', name: 'Full Stamina Potion',  resource: 'stamina', restoreType: 'full' },
        largeStamina: { invId: '1044033151', name: 'Large Stamina Potion', resource: 'stamina', restoreType: 'large' },
        manaS:        { invId: '1043177023', name: 'Mana Potion S',        resource: 'mp',      restoreAmount: 20 },
        manaL:        { invId: '1045177548', name: 'Mana Potion L',        resource: 'mp',      restoreAmount: 200 },
        fullHp:       { invId: '1044198900', name: 'Full Hp Potion',       resource: 'hp',      restoreType: 'full' },
    };

    const DEFAULT_MONSTER_CONFIG = {
        enabled: false,
        dmgThreshold: 75000,
        attackId: '0',
        skillId: '',
        priority: 10,
    };

    const DEFAULT_CONFIG = {
        potionsEnabled: false,
        potionConfig: {
            fullStamina:  { enabled: false, threshold: 0, minReserve: 0, useForAction: true },
            largeStamina: { enabled: false, threshold: 0, minReserve: 0, useForAction: true },
            manaS:        { enabled: false, threshold: 0, minReserve: 0, useForAction: true },
            manaL:        { enabled: false, threshold: 0, minReserve: 0, useForAction: true },
            fullHp:       { enabled: false, threshold: 0, minReserve: 0 },
        },
        soundStaminaOut: true,
        keepCheckingStamina: false,
        staminaCheckInterval: 5,
        showStandbyWarning: true,
        lootSelectedMonsters: [],
        activeWaves: null,
    };

    const DEFAULT_HISTORY = {
        farm: {
            attacks: {},        // keyed by dataName: { count, dmg, stamina, mp, joined }
            totalStamina: 0,
            totalMp: 0,
            totalDmg: 0,
            totalHits: 0,
            totalFightsJoined: 0,
        },
        loot: {
            totalExp: 0,
            totalGold: 0,
            totalMonstersLooted: 0,
            items: {},
        },
        encounters: [],  // Array of { id, dataName, dmg, stamina, hits, potionsUsed, attacksUsed:{}, skillsUsed:{}, status:'alive'|'dead', startTime }
    };

    // Thunder alert sound (base64 encoded short thunder rumble)
    const THUNDER_SOUND_B64 = (() => {
        const sampleRate = 8000;
        const duration = 0.8;
        const samples = sampleRate * duration;
        const buffer = new Float32Array(samples);
        for (let i = 0; i < samples; i++) {
            const t = i / sampleRate;
            const env = Math.exp(-t * 4) * (1 + 0.5 * Math.sin(t * 60));
            const noise = (Math.random() * 2 - 1);
            const rumble = Math.sin(t * 80 * Math.PI) * 0.3 + Math.sin(t * 40 * Math.PI) * 0.2;
            buffer[i] = (noise * 0.7 + rumble) * env;
        }
        // Encode to WAV
        const numChannels = 1;
        const bitsPerSample = 16;
        const byteRate = sampleRate * numChannels * bitsPerSample / 8;
        const blockAlign = numChannels * bitsPerSample / 8;
        const dataSize = samples * blockAlign;
        const wavBuffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(wavBuffer);
        const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
        writeStr(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); writeStr(8, 'WAVE');
        writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
        view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true); view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true); writeStr(36, 'data'); view.setUint32(40, dataSize, true);
        for (let i = 0; i < samples; i++) {
            const s = Math.max(-1, Math.min(1, buffer[i]));
            view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
        const bytes = new Uint8Array(wavBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return 'data:audio/wav;base64,' + btoa(binary);
    })();

    function playThunder() {
        try { new Audio(THUNDER_SOUND_B64).play(); } catch(e) {}
    }

    // =========================================================================
    // --- State & Config ---
    // =========================================================================
    let myTabId = sessionStorage.getItem("veyra_af2_tab_id");
    const navType = performance.getEntriesByType('navigation')[0]?.type;
    if (!myTabId || navType !== 'reload') {
        myTabId = Math.random().toString(36).substr(2, 9);
        sessionStorage.setItem("veyra_af2_tab_id", myTabId);
    }

    let isMaster = false;

    let monsterConfig = await GM.getValue("veyra_af2_monster_config", null);
    monsterConfig = monsterConfig || {};

    let globalConfig = await GM.getValue("veyra_af2_config", null);
    globalConfig = { ...DEFAULT_CONFIG, ...(globalConfig || {}) };
    globalConfig.potionConfig = { ...DEFAULT_CONFIG.potionConfig, ...(globalConfig.potionConfig || {}) };
    if (!globalConfig.activeWaves) globalConfig.activeWaves = Object.keys(WAVES);

    let history = await GM.getValue("veyra_af2_history", null);
    history = history || {};
    history.farm = { ...DEFAULT_HISTORY.farm, ...(history.farm || {}) };
    history.loot = { ...DEFAULT_HISTORY.loot, ...(history.loot || {}) };
    if (!Array.isArray(history.encounters)) history.encounters = [];

    let isRunning = await GM.getValue("veyra_af2_running", false);
    let isLooting = false;
    let currentLoopTimeout = null;

    let liveMonsters = {};
    let deadMonsters = {};

    // Currently active encounter being tracked (set during attackEnemy)
    let activeEncounter = null;

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const randomDelay = (min, max) => sleep(Math.floor(Math.random() * (max - min + 1)) + min);

    function getCookie(name) {
        const value = '; ' + document.cookie;
        const parts = value.split('; ' + name + '=');
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }

    async function saveGlobalConfig() { await GM.setValue("veyra_af2_config", globalConfig); }
    async function saveMonsterCfg() { await GM.setValue("veyra_af2_monster_config", monsterConfig); }
    async function saveHistory() { await GM.setValue("veyra_af2_history", history); }

    function saveMonsterConfigField(monsterName, key, value) {
        if (!monsterConfig[monsterName]) monsterConfig[monsterName] = { ...DEFAULT_MONSTER_CONFIG };
        monsterConfig[monsterName][key] = value;
        saveMonsterCfg();
    }

    function getMonsterConf(dataName) {
        return { ...DEFAULT_MONSTER_CONFIG, ...(monsterConfig[dataName] || {}) };
    }

    // =========================================================================
    // --- Status & Stats Helpers ---
    // =========================================================================
    function appendStatus(text, cssClass, targetBox = 'af2-farm-status') {
        const box = document.getElementById(targetBox);
        if (!box) return;
        const lines = box.querySelectorAll('.af2-status-line');
        if (lines.length >= 12) lines[0].remove();
        const p = document.createElement('p');
        p.className = 'af2-status-line' + (cssClass ? ' af2-status-' + cssClass : '');
        p.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
        box.appendChild(p);
        box.scrollTop = box.scrollHeight;
    }

    // --- Encounter Tracking ---
    function startEncounter(enemyId, dataName) {
        activeEncounter = {
            id: enemyId,
            dataName: dataName,
            dmg: 0,
            stamina: 0,
            hits: 0,
            potionsUsed: 0,
            attacksUsed: {},   // keyed by attack name: count
            skillsUsed: {},    // keyed by skill name: count
            status: 'alive',
            startTime: Date.now(),
        };
    }

    function recordHit(attackName, skillName, dmg, staminaUsed, mpUsed) {
        if (!activeEncounter) return;

        activeEncounter.dmg += dmg;
        activeEncounter.stamina += staminaUsed;
        activeEncounter.hits++;

        if (attackName) {
            activeEncounter.attacksUsed[attackName] = (activeEncounter.attacksUsed[attackName] || 0) + 1;
        }
        if (skillName) {
            activeEncounter.skillsUsed[skillName] = (activeEncounter.skillsUsed[skillName] || 0) + 1;
        }

        // Update overall history
        history.farm.totalDmg += dmg;
        history.farm.totalStamina += staminaUsed;
        history.farm.totalMp += mpUsed;
        history.farm.totalHits++;

        // Update per-monster-type summary
        const dn = activeEncounter.dataName;
        if (!history.farm.attacks[dn]) {
            history.farm.attacks[dn] = { count: 0, dmg: 0, stamina: 0, mp: 0, joined: 0 };
        }
        history.farm.attacks[dn].count++;
        history.farm.attacks[dn].dmg += dmg;
        history.farm.attacks[dn].stamina += staminaUsed;
        history.farm.attacks[dn].mp += mpUsed;
    }

    function recordPotionUsed() {
        if (activeEncounter) activeEncounter.potionsUsed++;
    }

    function finalizeEncounter(status) {
        if (!activeEncounter) return;
        activeEncounter.status = status;

        // Increment joined count for this monster type
        const dn = activeEncounter.dataName;
        if (!history.farm.attacks[dn]) {
            history.farm.attacks[dn] = { count: 0, dmg: 0, stamina: 0, mp: 0, joined: 0 };
        }
        history.farm.attacks[dn].joined++;
        history.farm.totalFightsJoined++;

        // Push encounter to history
        history.encounters.unshift({ ...activeEncounter });

        // Cap encounters at 200
        if (history.encounters.length > 200) history.encounters.length = 200;

        activeEncounter = null;
        saveHistory();
        renderHistory();
    }

    function trackLoot(exp, gold, items) {
        history.loot.totalExp += exp;
        history.loot.totalGold += gold;
        history.loot.totalMonstersLooted++;
        if (items && items.length > 0) {
            for (const item of items) {
                const key = item.NAME || `Item #${item.ITEM_ID}`;
                if (!history.loot.items[key]) history.loot.items[key] = { qty: 0, tier: item.TIER || 'COMMON', imageUrl: item.IMAGE_URL || '' };
                history.loot.items[key].qty += (item.QUANTITY || 1);
            }
        }
        saveHistory();
        renderHistory();
    }

    // =========================================================================
    // --- UI Setup ---
    // =========================================================================
    async function setupUI() {
        let savedUI = await GM.getValue("veyra_af2_ui", null);
        if (!savedUI || typeof savedUI !== 'object') savedUI = {};
        if (!savedUI.left) savedUI.left = 'calc(100vw - 520px)';
        if (!savedUI.top) savedUI.top = '50px';
        if (!savedUI.width) savedUI.width = '480px';
        if (savedUI.minimized === undefined) savedUI.minimized = false;
        if (!savedUI.activeTab) savedUI.activeTab = 'farm';
        if (!savedUI.collapsedWaves) savedUI.collapsedWaves = {};

        const css = `
        #af2-container {
            position: fixed;
            top: ${savedUI.top};
            left: ${savedUI.left};
            width: ${savedUI.width};
            max-height: 85vh;
            min-width: 380px;
            background: rgba(15, 12, 20, 0.95);
            border: 1px solid rgba(100, 80, 160, 0.4);
            border-radius: 12px;
            color: #e2dff0;
            font-family: 'Segoe UI', system-ui, sans-serif;
            z-index: 999999;
            display: flex;
            flex-direction: column;
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.8), 0 0 60px rgba(100, 60, 180, 0.1);
            backdrop-filter: blur(12px);
            resize: horizontal;
            overflow: hidden;
            font-size: 13px;
        }
        #af2-header {
            background: linear-gradient(135deg, rgba(30, 20, 50, 0.9) 0%, rgba(15, 10, 30, 0.9) 100%);
            padding: 10px 14px;
            cursor: grab;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid rgba(100, 80, 160, 0.3);
            user-select: none;
        }
        #af2-header:active { cursor: grabbing; }
        #af2-title { font-weight: bold; font-size: 15px; color: #c4a0ff; }
        .af2-btn-minimize { background: none; border: none; color: #9b7ed8; cursor: pointer; font-size: 18px; font-weight: bold; }
        .af2-btn-minimize:hover { color: white; }

        .af2-minimized #af2-content { display: none; }

        .af2-tabs { display: flex; border-bottom: 1px solid rgba(100, 80, 160, 0.2); background: rgba(20, 15, 35, 0.6); }
        .af2-tab { padding: 8px 12px; cursor: pointer; font-weight: bold; color: #9b8cba; transition: 0.2s; border-bottom: 2px solid transparent; flex:1; text-align:center; font-size: 12px; }
        .af2-tab:hover { color: #e2dff0; background: rgba(255,255,255,0.03); }
        .af2-tab.active { color: #c4a0ff; border-bottom-color: #9b7ed8; background: rgba(100, 60, 180, 0.1); }

        #af2-content { display: flex; flex-direction: column; overflow: hidden; flex-grow: 1; }
        .af2-tab-content { display: none; flex-direction: column; padding: 12px; overflow-y: auto; flex-grow: 1; gap: 10px; max-height: 65vh; }
        .af2-tab-content.active { display: flex; }

        .af2-section { background: rgba(25, 20, 40, 0.6); border: 1px solid rgba(100, 80, 160, 0.2); border-radius: 8px; padding: 10px; }
        .af2-section-title { font-weight: bold; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #9b7ed8; margin-bottom: 8px; }

        .af2-status-box {
            background: rgba(10, 8, 18, 0.8); border: 1px solid rgba(100, 80, 160, 0.15); border-radius: 6px; padding: 8px;
            font-size: 11px; color: #8a80a0; height: 80px; overflow-y: auto; font-family: 'Consolas', monospace; line-height: 1.5;
        }
        .af2-status-line { margin: 0; }
        .af2-status-action { color: #7c9df5; }
        .af2-status-good { color: #4ade80; }
        .af2-status-bad { color: #f87171; }
        .af2-status-info { color: #fbbf24; }

        .af2-btn {
            padding: 7px 14px; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 12px;
            transition: all 0.2s; color: white;
        }
        .af2-btn-start { background: linear-gradient(135deg, #7c3aed, #6d28d9); }
        .af2-btn-start:hover { background: linear-gradient(135deg, #8b5cf6, #7c3aed); }
        .af2-btn-stop { background: linear-gradient(135deg, #dc2626, #b91c1c); }
        .af2-btn-stop:hover { background: linear-gradient(135deg, #ef4444, #dc2626); }
        .af2-btn-dark { background: rgba(60, 50, 90, 0.6); border: 1px solid rgba(100, 80, 160, 0.3); }
        .af2-btn-dark:hover { background: rgba(80, 65, 120, 0.7); }

        /* Wave collapsible */
        .af2-wave-header {
            display: flex; align-items: center; gap: 8px; padding: 6px 8px; margin-top: 6px;
            background: rgba(40, 30, 65, 0.5); border-radius: 6px; cursor: pointer; user-select: none;
            border: 1px solid rgba(100, 80, 160, 0.15);
        }
        .af2-wave-header:hover { background: rgba(50, 40, 80, 0.6); }
        .af2-wave-arrow { transition: transform 0.2s; font-size: 10px; color: #9b7ed8; }
        .af2-wave-arrow.collapsed { transform: rotate(-90deg); }
        .af2-wave-title { font-weight: bold; font-size: 13px; color: #c4a0ff; flex: 1; }
        .af2-wave-count { font-size: 11px; color: #8a80a0; }
        .af2-wave-content { overflow: hidden; transition: max-height 0.3s ease; }
        .af2-wave-content.collapsed { max-height: 0 !important; padding: 0; }

        /* Monster cards */
        .af2-monster-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; padding-top: 8px; }
        .af2-monster-card {
            background: rgba(20, 15, 35, 0.7); border-radius: 8px; padding: 8px;
            border: 1px solid rgba(100, 80, 160, 0.2); display: flex; flex-direction: column; gap: 6px;
        }
        .af2-monster-header { display: flex; align-items: center; gap: 8px; }
        .af2-monster-header img { width: 32px; height: 32px; border-radius: 6px; object-fit: cover; border: 1px solid rgba(100,80,160,0.3); }
        .af2-monster-header span { flex-grow: 1; font-weight: bold; font-size: 12px; color: #d4ccf0; }
        .af2-controls-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
        .af2-input-group { display: flex; flex-direction: column; gap: 2px; }
        .af2-input-group label { font-size: 10px; color: #8a80a0; }
        .af2-input-group input, .af2-input-group select {
            background: rgba(15, 10, 25, 0.8); border: 1px solid rgba(100, 80, 160, 0.25);
            color: #e2dff0; padding: 4px 6px; border-radius: 4px; font-size: 11px; width: 100%; box-sizing: border-box;
        }

        /* Loot multi-select pills */
        .af2-pill-container { display: flex; flex-wrap: wrap; gap: 6px; }
        .af2-pill {
            display: flex; align-items: center; gap: 5px; padding: 5px 10px;
            border-radius: 20px; font-size: 11px; font-weight: bold; cursor: pointer;
            border: 1px solid rgba(100, 80, 160, 0.3); transition: all 0.2s; user-select: none;
            background: rgba(25, 20, 40, 0.6); color: #9b8cba;
        }
        .af2-pill:hover { border-color: rgba(140, 110, 200, 0.5); background: rgba(40, 30, 65, 0.7); }
        .af2-pill.selected { background: rgba(100, 60, 180, 0.3); border-color: #9b7ed8; color: #c4a0ff; }
        .af2-pill img { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; }

        /* Config potion cards */
        .af2-potion-card {
            background: rgba(20, 15, 35, 0.5); border: 1px solid rgba(100, 80, 160, 0.15);
            border-radius: 8px; padding: 10px; margin-bottom: 6px;
        }
        .af2-potion-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
        .af2-potion-name { font-weight: bold; font-size: 12px; color: #c4a0ff; flex: 1; }
        .af2-slider-row { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
        .af2-slider-row label { font-size: 10px; color: #8a80a0; min-width: 70px; }
        .af2-slider-row input[type="range"] { flex: 1; accent-color: #9b7ed8; }
        .af2-slider-row .af2-slider-val { font-size: 11px; color: #c4a0ff; min-width: 30px; text-align: right; }
        .af2-number-row { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
        .af2-number-row label { font-size: 10px; color: #8a80a0; flex: 1; }
        .af2-number-row input[type="number"] {
            width: 60px; background: rgba(15,10,25,0.8); border: 1px solid rgba(100,80,160,0.25);
            color: #e2dff0; padding: 3px 6px; border-radius: 4px; font-size: 11px;
        }
        .af2-checkbox-row { display: flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 11px; color: #9b8cba; cursor: pointer; }

        /* History columns */
        .af2-history-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .af2-history-col { display: flex; flex-direction: column; gap: 8px; }
        .af2-history-item { background: rgba(20, 15, 35, 0.5); border-radius: 6px; padding: 8px; border: 1px solid rgba(100,80,160,0.15); }
        .af2-history-label { font-size: 10px; color: #8a80a0; text-transform: uppercase; }
        .af2-history-value { font-size: 16px; font-weight: bold; color: #e2dff0; }
        .af2-item-list { max-height: 150px; overflow-y: auto; }
        .af2-item-row { display: flex; justify-content: space-between; padding: 2px 0; font-size: 11px; border-bottom: 1px solid rgba(100,80,160,0.1); }
        .af2-item-name { color: #d4ccf0; }
        .af2-item-qty { color: #fbbf24; font-weight: bold; }
        .af2-tier-common { color: #94a3b8; } .af2-tier-uncommon { color: #4ade80; }
        .af2-tier-rare { color: #60a5fa; } .af2-tier-epic { color: #c084fc; }
        .af2-tier-legendary { color: #fbbf24; }

        /* Encounter History Cards */
        .af2-encounter-card {
            display: flex;
            background: rgba(20, 15, 35, 0.6);
            border: 1px solid rgba(100, 80, 160, 0.2);
            border-radius: 8px;
            margin-bottom: 6px;
            overflow: hidden;
        }
        .af2-enc-left {
            display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
            padding: 10px; min-width: 70px;
            border-right: 1px solid rgba(100, 80, 160, 0.2);
            background: rgba(10, 8, 18, 0.4);
        }
        .af2-enc-icon {
            width: 48px; height: 48px; border-radius: 8px; object-fit: cover;
            border: 1px solid rgba(100, 80, 160, 0.3);
        }
        .af2-enc-view-btn {
            padding: 3px 0; width: 48px; text-align: center; font-size: 10px; font-weight: bold;
            background: rgba(60, 50, 90, 0.7); border: 1px solid rgba(100, 80, 160, 0.3);
            color: #c4a0ff; border-radius: 4px; cursor: pointer; transition: 0.2s;
        }
        .af2-enc-view-btn:hover { background: rgba(100, 60, 180, 0.4); }
        .af2-enc-right { flex: 1; padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; }
        .af2-enc-title { font-weight: bold; font-size: 13px; color: #d4ccf0; }
        .af2-enc-title .af2-enc-status-dead { color: #f87171; }
        .af2-enc-title .af2-enc-status-alive { color: #4ade80; }
        .af2-enc-stat { font-size: 11px; color: #9b8cba; }
        .af2-enc-stat b { color: #c4a0ff; }

        /* Loot card in loot tab */
        .af2-loot-card { display: flex; align-items: center; gap: 8px; padding: 6px; background: rgba(20,15,35,0.5); border-radius: 6px; border: 1px solid rgba(100,80,160,0.15); margin-bottom: 4px; }
        .af2-loot-card img { width: 28px; height: 28px; border-radius: 6px; object-fit: cover; }
        .af2-loot-card span { font-size: 12px; }
        .af2-loot-count { color: #fbbf24; font-weight: bold; margin-left: auto; }

        /* Loot Results Modal */
        .af2-loot-modal-overlay {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0,0,0,0.5); z-index: 9999999; display: flex; align-items: center; justify-content: center;
        }
        .af2-loot-modal {
            background: rgba(15, 12, 20, 0.97); border: 1px solid rgba(100, 80, 160, 0.5);
            border-radius: 12px; width: 360px; max-height: 70vh; display: flex; flex-direction: column;
            box-shadow: 0 12px 40px rgba(0,0,0,0.8), 0 0 60px rgba(100,60,180,0.15);
            backdrop-filter: blur(12px); color: #e2dff0; font-family: 'Segoe UI', system-ui, sans-serif;
        }
        .af2-loot-modal-header {
            padding: 10px 14px; display: flex; justify-content: space-between; align-items: center;
            border-bottom: 1px solid rgba(100, 80, 160, 0.3);
            background: linear-gradient(135deg, rgba(30, 20, 50, 0.9), rgba(15, 10, 30, 0.9));
            border-radius: 12px 12px 0 0; cursor: grab; user-select: none;
        }
        .af2-loot-modal-header:active { cursor: grabbing; }
        .af2-loot-modal-title { font-weight: bold; font-size: 14px; color: #c4a0ff; }
        .af2-loot-modal-close { background: none; border: none; color: #9b7ed8; cursor: pointer; font-size: 18px; font-weight: bold; }
        .af2-loot-modal-close:hover { color: white; }
        .af2-loot-modal-body { padding: 12px; overflow-y: auto; flex: 1; }
        .af2-loot-modal-item {
            display: flex; align-items: center; gap: 8px; padding: 5px 0;
            border-bottom: 1px solid rgba(100, 80, 160, 0.1); font-size: 12px;
        }
        .af2-loot-modal-item img { width: 24px; height: 24px; border-radius: 4px; object-fit: cover; flex-shrink: 0; }
        .af2-loot-modal-item .af2-lm-name { flex: 1; color: #d4ccf0; }
        .af2-loot-modal-item .af2-lm-qty { font-weight: bold; color: #fbbf24; }
        .af2-loot-modal-summary { padding: 8px 12px; border-top: 1px solid rgba(100,80,160,0.3); font-size: 12px; display:flex; gap:12px; justify-content:center; }
        .af2-loot-modal-summary span { font-weight: bold; }
        .af2-loot-modal-summary .af2-lms-exp { color: #4ade80; }
        .af2-loot-modal-summary .af2-lms-gold { color: #fbbf24; }
        `;
        const styleEl = document.createElement('style');
        styleEl.textContent = css;
        document.head.appendChild(styleEl);

        const container = document.createElement('div');
        container.id = 'af2-container';
        if (savedUI.minimized) container.classList.add('af2-minimized');

        container.innerHTML = `
            <div id="af2-header">
                <div id="af2-title">⚔️ AutoFarm 2.0</div>
                <button class="af2-btn-minimize" id="af2-toggle-min">${savedUI.minimized ? '+' : '×'}</button>
            </div>
            <div id="af2-content">
                <div class="af2-tabs">
                    <div class="af2-tab ${savedUI.activeTab === 'farm' ? 'active' : ''}" data-tab="farm">Farm</div>
                    <div class="af2-tab ${savedUI.activeTab === 'loot' ? 'active' : ''}" data-tab="loot">Loot</div>
                    <div class="af2-tab ${savedUI.activeTab === 'history' ? 'active' : ''}" data-tab="history">History</div>
                    <div class="af2-tab ${savedUI.activeTab === 'config' ? 'active' : ''}" data-tab="config">Config</div>
                </div>

                <!-- FARM TAB -->
                <div id="af2-tab-farm" class="af2-tab-content ${savedUI.activeTab === 'farm' ? 'active' : ''}">
                    <div class="af2-section" style="display:flex; gap:8px; align-items:center;">
                        <button id="af2-start-btn" class="af2-btn ${isRunning ? 'af2-btn-stop' : 'af2-btn-start'}" style="flex:1;">
                            ${isRunning ? '⏹ Stop Farming' : '▶ Start Farming'}
                        </button>
                        <button id="af2-scan-btn" class="af2-btn af2-btn-dark" style="padding:7px 10px;">🔄 Scan</button>
                    </div>
                    <div class="af2-section">
                        <div class="af2-section-title">Farm Status</div>
                        <div id="af2-farm-status" class="af2-status-box">Idle.</div>
                    </div>
                    <div class="af2-section">
                        <div class="af2-section-title">Target Waves</div>
                        <div id="af2-wave-checkboxes" style="display:flex; gap:10px; flex-wrap:wrap; font-size:12px;">
                            ${Object.entries(WAVES).map(([wq, w]) =>
                                `<label style="cursor:pointer; color:#9b8cba;">
                                    <input type="checkbox" class="af2-wave-cb" value="${wq}" ${globalConfig.activeWaves.includes(wq) ? 'checked' : ''}> ${w.name}
                                </label>`
                            ).join('')}
                        </div>
                    </div>
                    <div id="af2-farm-monsters">Loading monsters...</div>
                </div>

                <!-- LOOT TAB -->
                <div id="af2-tab-loot" class="af2-tab-content ${savedUI.activeTab === 'loot' ? 'active' : ''}">
                    <div class="af2-section">
                        <div class="af2-section-title">Select Monsters to Loot</div>
                        <div id="af2-loot-pills" class="af2-pill-container">
                            ${Object.entries(MONSTERS).map(([key, m]) =>
                                `<div class="af2-pill ${globalConfig.lootSelectedMonsters.includes(key) ? 'selected' : ''}" data-monster="${key}">
                                    <img src="https://demonicscans.org/${m.img}" onerror="this.style.display='none'" alt="">
                                    ${m.displayName}
                                </div>`
                            ).join('')}
                        </div>
                    </div>
                    <div class="af2-section" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <button id="af2-loot-all" class="af2-btn af2-btn-dark" style="flex:1;">Loot All</button>
                        <button id="af2-loot-selected" class="af2-btn af2-btn-start" style="flex:1;">Loot Selected</button>
                        <button id="af2-loot-x" class="af2-btn af2-btn-start" style="flex:1;">Loot X Monsters</button>
                        <input type="number" id="af2-loot-x-amount" min="1" value="5" style="width:55px; background:rgba(15,10,25,0.8); border:1px solid rgba(100,80,160,0.25); color:#e2dff0; padding:5px 6px; border-radius:4px; font-size:12px; font-weight:bold;">
                    </div>
                    <div class="af2-section" style="display:flex; gap:8px; align-items:center;">
                        <button id="af2-scan-dead-btn" class="af2-btn af2-btn-dark" style="flex:1;">🔄 Force Refresh</button>
                    </div>
                    <div class="af2-section">
                        <div class="af2-section-title">Loot Status</div>
                        <div id="af2-loot-status" class="af2-status-box">Ready. Switch to this tab or press Force Refresh to scan.</div>
                    </div>
                    <div id="af2-loot-monsters">Loading dead monsters...</div>
                </div>

                <!-- CONFIG TAB -->
                <div id="af2-tab-config" class="af2-tab-content ${savedUI.activeTab === 'config' ? 'active' : ''}">
                    <div class="af2-section">
                        <div class="af2-section-title">General</div>
                        <label class="af2-checkbox-row">
                            <input type="checkbox" id="af2-cfg-sound" ${globalConfig.soundStaminaOut ? 'checked' : ''}>
                            🔊 Thunder alert when stamina runs out
                        </label>
                        <label class="af2-checkbox-row">
                            <input type="checkbox" id="af2-cfg-keep-checking" ${globalConfig.keepCheckingStamina ? 'checked' : ''}>
                            🔁 Keep checking for stamina regeneration
                        </label>
                        <div class="af2-number-row" id="af2-cfg-check-interval-row" style="display:${globalConfig.keepCheckingStamina ? 'flex' : 'none'}">
                            <label>Check every (minutes)</label>
                            <input type="number" id="af2-cfg-check-interval" value="${globalConfig.staminaCheckInterval}" min="1" max="60">
                        </div>
                        <label class="af2-checkbox-row">
                            <input type="checkbox" id="af2-cfg-standby-warn" ${globalConfig.showStandbyWarning ? 'checked' : ''}>
                            ⚠️ Show standby warning on other tabs
                        </label>
                    </div>

                    <div class="af2-section">
                        <div class="af2-section-title">Potions</div>
                        <label class="af2-checkbox-row" style="font-size:13px; font-weight:bold; color:#c4a0ff;">
                            <input type="checkbox" id="af2-cfg-potions-global" ${globalConfig.potionsEnabled ? 'checked' : ''}>
                            Enable Potions
                        </label>
                        <div id="af2-potions-container" style="display:${globalConfig.potionsEnabled ? 'block' : 'none'}; margin-top: 8px;">
                            ${Object.entries(POTIONS).map(([key, pot]) => {
                                const pc = globalConfig.potionConfig[key] || {};
                                const isStaminaOrMp = (pot.resource === 'stamina' || pot.resource === 'mp');
                                return `
                                <div class="af2-potion-card" data-potion-key="${key}">
                                    <div class="af2-potion-header">
                                        <span class="af2-potion-name">${pot.name}</span>
                                        <label style="font-size:11px; color:#8a80a0; cursor:pointer;">
                                            <input type="checkbox" class="af2-potion-enable" data-key="${key}" ${pc.enabled ? 'checked' : ''}> Enabled
                                        </label>
                                    </div>
                                    <div class="af2-potion-details" data-key="${key}" style="display:${pc.enabled ? 'block' : 'none'}">
                                        <div class="af2-slider-row">
                                            <label>Threshold</label>
                                            <input type="range" class="af2-potion-threshold" data-key="${key}" min="0" max="100" value="${pc.threshold || 0}">
                                            <span class="af2-slider-val">${pc.threshold || 0}%</span>
                                        </div>
                                        <div class="af2-number-row">
                                            <label>Min. inventory reserve</label>
                                            <input type="number" class="af2-potion-reserve" data-key="${key}" value="${pc.minReserve || 0}" min="0">
                                        </div>
                                        ${isStaminaOrMp ? `
                                        <label class="af2-checkbox-row">
                                            <input type="checkbox" class="af2-potion-action-prereq" data-key="${key}" ${pc.useForAction !== false ? 'checked' : ''}>
                                            Use if needed to execute action
                                        </label>` : ''}
                                    </div>
                                </div>`;
                            }).join('')}
                        </div>
                    </div>
                </div>

                <!-- HISTORY TAB -->
                <div id="af2-tab-history" class="af2-tab-content ${savedUI.activeTab === 'history' ? 'active' : ''}">
                    <div class="af2-section-title" style="text-align:center; margin-bottom:4px;">📊 Overall History Stats</div>
                    <div class="af2-history-cols">
                        <div class="af2-history-col">
                            <div class="af2-section-title" style="text-align:center;">⚔️ Farm History</div>
                            <div id="af2-history-farm"></div>
                        </div>
                        <div class="af2-history-col">
                            <div class="af2-section-title" style="text-align:center;">💰 Loot History</div>
                            <div id="af2-history-loot"></div>
                        </div>
                    </div>
                    <div style="margin-top:12px;">
                        <div class="af2-section-title" style="text-align:center;">📜 Encounter History</div>
                        <div id="af2-history-encounters"></div>
                    </div>
                    <button id="af2-clear-history" class="af2-btn af2-btn-dark" style="width:100%; margin-top:8px;">Clear All History</button>
                </div>
            </div>
        `;
        document.body.appendChild(container);

        // ---- Drag Logic (pointer-based, like AutoPvP 2.0) ----
        const header = document.getElementById('af2-header');
        let isDragging = false, startX, startY, initialX, initialY;
        header.onpointerdown = (e) => {
            if (e.target.closest('#af2-toggle-min')) return;
            isDragging = true;
            startX = e.clientX; startY = e.clientY;
            initialX = container.offsetLeft; initialY = container.offsetTop;
            header.style.cursor = 'grabbing';
            header.setPointerCapture(e.pointerId);
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
            await GM.setValue("veyra_af2_ui", savedUI);
        };
        header.onpointerup = stopDrag;
        header.onpointercancel = stopDrag;

        // ---- Minimize ----
        document.getElementById('af2-toggle-min').addEventListener('click', async () => {
            container.classList.toggle('af2-minimized');
            savedUI.minimized = container.classList.contains('af2-minimized');
            document.getElementById('af2-toggle-min').textContent = savedUI.minimized ? '+' : '×';
            await GM.setValue("veyra_af2_ui", savedUI);
        });

        // ---- Resize Observer ----
        const resizeObserver = new ResizeObserver(() => {
            if (!isDragging && container.style.width) {
                savedUI.width = container.style.width;
                GM.setValue("veyra_af2_ui", savedUI);
            }
        });
        resizeObserver.observe(container);

        // ---- Tab Switching ----
        let lootTabScanned = false;
        container.querySelectorAll('.af2-tab').forEach(tab => {
            tab.addEventListener('click', async () => {
                container.querySelectorAll('.af2-tab').forEach(t => t.classList.remove('active'));
                container.querySelectorAll('.af2-tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                const tabName = tab.dataset.tab;
                savedUI.activeTab = tabName;
                document.getElementById(`af2-tab-${tabName}`).classList.add('active');
                await GM.setValue("veyra_af2_ui", savedUI);

                if (tabName === 'loot' && !lootTabScanned) {
                    lootTabScanned = true;
                    appendStatus('Scanning dead monsters...', 'info', 'af2-loot-status');
                    await prefetchWaves('dead');
                }
                if (tabName === 'history') renderHistory();
            });
        });

        // ---- Wave Checkboxes ----
        container.querySelectorAll('.af2-wave-cb').forEach(cb => {
            cb.addEventListener('change', async () => {
                globalConfig.activeWaves = Array.from(container.querySelectorAll('.af2-wave-cb:checked')).map(el => el.value);
                await saveGlobalConfig();
                if (!isRunning) await prefetchWaves('alive');
            });
        });

        // ---- Farm Controls ----
        document.getElementById('af2-start-btn').addEventListener('click', async () => {
            isRunning = !isRunning;
            await GM.setValue("veyra_af2_running", isRunning);
            const btn = document.getElementById('af2-start-btn');
            btn.textContent = isRunning ? '⏹ Stop Farming' : '▶ Start Farming';
            btn.className = 'af2-btn ' + (isRunning ? 'af2-btn-stop' : 'af2-btn-start');
            if (isRunning) {
                loop();
            } else {
                if (currentLoopTimeout) clearTimeout(currentLoopTimeout);
            }
        });

        document.getElementById('af2-scan-btn').addEventListener('click', () => prefetchWaves('alive'));

        // ---- Loot Controls ----
        // Pill toggle
        container.querySelectorAll('.af2-pill').forEach(pill => {
            pill.addEventListener('click', async () => {
                pill.classList.toggle('selected');
                globalConfig.lootSelectedMonsters = Array.from(container.querySelectorAll('.af2-pill.selected')).map(p => p.dataset.monster);
                await saveGlobalConfig();
            });
        });

        document.getElementById('af2-loot-all').addEventListener('click', () => doBatchLoot('all'));
        document.getElementById('af2-loot-selected').addEventListener('click', () => doBatchLoot('selected'));
        document.getElementById('af2-loot-x').addEventListener('click', () => {
            const amount = parseInt(document.getElementById('af2-loot-x-amount').value) || 1;
            doBatchLoot('selected', amount);
        });
        document.getElementById('af2-scan-dead-btn').addEventListener('click', async () => {
            appendStatus('Force refreshing dead monsters...', 'info', 'af2-loot-status');
            await prefetchWaves('dead');
        });

        // ---- Config Controls ----
        document.getElementById('af2-cfg-sound').addEventListener('change', async (e) => {
            globalConfig.soundStaminaOut = e.target.checked;
            await saveGlobalConfig();
        });
        document.getElementById('af2-cfg-keep-checking').addEventListener('change', async (e) => {
            globalConfig.keepCheckingStamina = e.target.checked;
            document.getElementById('af2-cfg-check-interval-row').style.display = e.target.checked ? 'flex' : 'none';
            await saveGlobalConfig();
        });
        document.getElementById('af2-cfg-check-interval').addEventListener('change', async (e) => {
            globalConfig.staminaCheckInterval = Math.max(1, parseInt(e.target.value) || 5);
            await saveGlobalConfig();
        });
        document.getElementById('af2-cfg-standby-warn').addEventListener('change', async (e) => {
            globalConfig.showStandbyWarning = e.target.checked;
            await saveGlobalConfig();
        });

        // Global potions toggle
        document.getElementById('af2-cfg-potions-global').addEventListener('change', async (e) => {
            globalConfig.potionsEnabled = e.target.checked;
            document.getElementById('af2-potions-container').style.display = e.target.checked ? 'block' : 'none';
            await saveGlobalConfig();
        });

        // Individual potion enables
        container.querySelectorAll('.af2-potion-enable').forEach(cb => {
            cb.addEventListener('change', async (e) => {
                const key = e.target.dataset.key;
                if (!globalConfig.potionConfig[key]) globalConfig.potionConfig[key] = {};
                globalConfig.potionConfig[key].enabled = e.target.checked;
                container.querySelector(`.af2-potion-details[data-key="${key}"]`).style.display = e.target.checked ? 'block' : 'none';
                await saveGlobalConfig();
            });
        });

        // Potion sliders
        container.querySelectorAll('.af2-potion-threshold').forEach(slider => {
            slider.addEventListener('input', (e) => {
                e.target.closest('.af2-potion-details').querySelector('.af2-slider-val').textContent = e.target.value + '%';
            });
            slider.addEventListener('change', async (e) => {
                const key = e.target.dataset.key;
                globalConfig.potionConfig[key].threshold = parseInt(e.target.value);
                await saveGlobalConfig();
            });
        });

        // Potion reserves
        container.querySelectorAll('.af2-potion-reserve').forEach(input => {
            input.addEventListener('change', async (e) => {
                const key = e.target.dataset.key;
                globalConfig.potionConfig[key].minReserve = Math.max(0, parseInt(e.target.value) || 0);
                await saveGlobalConfig();
            });
        });

        // Potion action prereq
        container.querySelectorAll('.af2-potion-action-prereq').forEach(cb => {
            cb.addEventListener('change', async (e) => {
                const key = e.target.dataset.key;
                globalConfig.potionConfig[key].useForAction = e.target.checked;
                await saveGlobalConfig();
            });
        });

        // ---- History ----
        document.getElementById('af2-clear-history').addEventListener('click', async () => {
            history = JSON.parse(JSON.stringify(DEFAULT_HISTORY));
            await saveHistory();
            renderHistory();
        });

        // Initial render
        renderHistory();
        await prefetchWaves('alive');

        // Auto-scan dead monsters every 60s
        setInterval(async () => {
            await prefetchWaves('dead');
        }, 60000);
    }

    // =========================================================================
    // --- UI Renderers ---
    // =========================================================================
    function renderFarmMonsters() {
        const container = document.getElementById('af2-farm-monsters');
        if (!container) return;
        container.innerHTML = '';
        let foundAny = false;

        const attackOpts = Object.entries(ATTACKS).map(([id, a]) =>
            `<option value="${id}">${a.name} (${a.staminaCost} STA)</option>`
        ).join('');
        const skillOpts = `<option value="">None</option>` + Object.entries(SKILLS).map(([id, s]) =>
            `<option value="${id}">${s.name} (${s.mpCost} MP) [${s.type}]</option>`
        ).join('');

        for (const [waveQuery, waveInfo] of Object.entries(WAVES)) {
            const waveGroup = liveMonsters[waveQuery];
            if (!waveGroup || Object.keys(waveGroup).length === 0) continue;
            foundAny = true;

            const count = Object.values(waveGroup).reduce((sum, m) => sum + m.ids.length, 0);
            const isCollapsed = false;

            const section = document.createElement('div');
            section.innerHTML = `
                <div class="af2-wave-header" data-wave="${waveQuery}">
                    <span class="af2-wave-arrow ${isCollapsed ? 'collapsed' : ''}">▼</span>
                    <span class="af2-wave-title">${waveInfo.name}</span>
                    <span class="af2-wave-count">${count} mob${count > 1 ? 's' : ''}</span>
                </div>
                <div class="af2-wave-content ${isCollapsed ? 'collapsed' : ''}">
                    <div class="af2-monster-grid"></div>
                </div>
            `;

            const grid = section.querySelector('.af2-monster-grid');
            for (const [dataName, m] of Object.entries(waveGroup)) {
                const conf = getMonsterConf(dataName);
                const imgSrc = m.img || (MONSTERS[dataName]?.img ? `https://demonicscans.org/${MONSTERS[dataName].img}` : '');

                const selAttack = attackOpts.replace(`value="${conf.attackId}"`, `value="${conf.attackId}" selected`);
                const selSkill = skillOpts.replace(`value="${conf.skillId}"`, `value="${conf.skillId}" selected`);

                const card = document.createElement('div');
                card.className = 'af2-monster-card';
                card.innerHTML = `
                    <div class="af2-monster-header">
                        <img src="${imgSrc}" alt="" onerror="this.style.display='none'">
                        <span>${m.name}</span>
                        <input type="checkbox" class="af2-m-enable" data-id="${dataName}" ${conf.enabled ? 'checked' : ''} title="Enable farming">
                    </div>
                    <div class="af2-controls-grid">
                        <div class="af2-input-group">
                            <label>DMG Threshold</label>
                            <input type="number" class="af2-m-thresh" data-id="${dataName}" value="${conf.dmgThreshold}">
                        </div>
                        <div class="af2-input-group">
                            <label>Priority (Lower = First)</label>
                            <input type="number" class="af2-m-prio" data-id="${dataName}" value="${conf.priority}">
                        </div>
                        <div class="af2-input-group">
                            <label>Attack</label>
                            <select class="af2-m-attack" data-id="${dataName}">${selAttack}</select>
                        </div>
                        <div class="af2-input-group">
                            <label>Skill</label>
                            <select class="af2-m-skill" data-id="${dataName}">${selSkill}</select>
                        </div>
                    </div>
                `;
                grid.appendChild(card);
            }
            container.appendChild(section);

            // Collapse toggle
            section.querySelector('.af2-wave-header').addEventListener('click', async () => {
                const content = section.querySelector('.af2-wave-content');
                const arrow = section.querySelector('.af2-wave-arrow');
                content.classList.toggle('collapsed');
                arrow.classList.toggle('collapsed');
            });
        }

        if (!foundAny) {
            container.innerHTML = '<div style="font-size:12px; color:#8a80a0; padding-top:10px;">No alive monsters found. Click Scan to refresh.</div>';
        }

        // Attach events
        container.querySelectorAll('.af2-m-enable').forEach(el => el.addEventListener('change', e => saveMonsterConfigField(e.target.dataset.id, 'enabled', e.target.checked)));
        container.querySelectorAll('.af2-m-thresh').forEach(el => el.addEventListener('change', e => saveMonsterConfigField(e.target.dataset.id, 'dmgThreshold', Number(e.target.value))));
        container.querySelectorAll('.af2-m-prio').forEach(el => el.addEventListener('change', e => saveMonsterConfigField(e.target.dataset.id, 'priority', Number(e.target.value))));
        container.querySelectorAll('.af2-m-attack').forEach(el => el.addEventListener('change', e => saveMonsterConfigField(e.target.dataset.id, 'attackId', String(e.target.value))));
        container.querySelectorAll('.af2-m-skill').forEach(el => el.addEventListener('change', e => saveMonsterConfigField(e.target.dataset.id, 'skillId', String(e.target.value))));
    }

    function renderLootMonsters() {
        const container = document.getElementById('af2-loot-monsters');
        if (!container) return;
        container.innerHTML = '';
        let foundAny = false;

        for (const [waveQuery, waveInfo] of Object.entries(WAVES)) {
            const waveGroup = deadMonsters[waveQuery];
            if (!waveGroup || Object.keys(waveGroup).length === 0) continue;
            foundAny = true;

            const header = document.createElement('div');
            header.className = 'af2-wave-header';
            header.style.cursor = 'default';
            header.innerHTML = `<span class="af2-wave-title" style="font-size:12px;">${waveInfo.name}</span>`;
            container.appendChild(header);

            for (const [dataName, m] of Object.entries(waveGroup)) {
                const card = document.createElement('div');
                card.className = 'af2-loot-card';
                const imgSrc = m.img || (MONSTERS[dataName]?.img ? `https://demonicscans.org/${MONSTERS[dataName].img}` : '');
                card.innerHTML = `
                    <img src="${imgSrc}" alt="" onerror="this.style.display='none'">
                    <span>${m.name}</span>
                    <span class="af2-loot-count">×${m.ids.length}</span>
                `;
                container.appendChild(card);
            }
        }

        if (!foundAny) {
            container.innerHTML = '<div style="font-size:12px; color:#8a80a0; padding-top:10px;">No dead monsters found to loot.</div>';
        }
    }

    function renderHistory() {
        const farmEl = document.getElementById('af2-history-farm');
        const lootEl = document.getElementById('af2-history-loot');
        const encEl = document.getElementById('af2-history-encounters');
        if (!farmEl || !lootEl || !encEl) return;

        // --- Farm History Column ---
        let farmHtml = `
            <div class="af2-history-item">
                <div class="af2-history-label">Fights Joined</div>
                <div class="af2-history-value">${(history.farm.totalFightsJoined || 0).toLocaleString()}</div>
            </div>
            <div class="af2-history-item">
                <div class="af2-history-label">Total Damage Dealt</div>
                <div class="af2-history-value">${history.farm.totalDmg.toLocaleString()}</div>
            </div>
            <div class="af2-history-item">
                <div class="af2-history-label">Total Stamina Used</div>
                <div class="af2-history-value">${history.farm.totalStamina.toLocaleString()}</div>
            </div>
            <div class="af2-history-item">
                <div class="af2-history-label">Total Hits</div>
                <div class="af2-history-value">${(history.farm.totalHits || 0).toLocaleString()}</div>
            </div>
        `;
        const attackEntries = Object.entries(history.farm.attacks);
        if (attackEntries.length > 0) {
            farmHtml += `<div class="af2-history-item"><div class="af2-history-label">Monsters Farm Summary</div><div class="af2-item-list">`;
            for (const [dataName, stats] of attackEntries) {
                const name = MONSTERS[dataName]?.displayName || dataName;
                const joined = stats.joined || 0;
                farmHtml += `<div class="af2-item-row" style="flex-direction:column; gap:0;">
                    <span class="af2-item-name">${joined}× ${name} ${stats.count}× (${stats.dmg.toLocaleString()} dmg) (${stats.stamina.toLocaleString()} sta)</span>
                </div>`;
            }
            farmHtml += `</div></div>`;
        }
        farmEl.innerHTML = farmHtml;

        // --- Loot History Column ---
        let lootHtml = `
            <div class="af2-history-item">
                <div class="af2-history-label">Total EXP Gained</div>
                <div class="af2-history-value" style="color:#4ade80;">${history.loot.totalExp.toLocaleString()}</div>
            </div>
            <div class="af2-history-item">
                <div class="af2-history-label">Total Gold Gained</div>
                <div class="af2-history-value" style="color:#fbbf24;">${history.loot.totalGold.toLocaleString()}</div>
            </div>
            <div class="af2-history-item">
                <div class="af2-history-label">Total Monsters Looted</div>
                <div class="af2-history-value">${(history.loot.totalMonstersLooted || 0).toLocaleString()}</div>
            </div>
        `;
        const itemEntries = Object.entries(history.loot.items);
        if (itemEntries.length > 0) {
            lootHtml += `<div class="af2-history-item"><div class="af2-history-label">Collected Items Summary</div><div class="af2-item-list">`;
            for (const [name, info] of itemEntries) {
                const tierClass = `af2-tier-${(info.tier || 'common').toLowerCase()}`;
                lootHtml += `<div class="af2-item-row">
                    <span class="af2-item-name ${tierClass}">${name}</span>
                    <span class="af2-item-qty">×${info.qty}</span>
                </div>`;
            }
            lootHtml += `</div></div>`;
        }
        lootEl.innerHTML = lootHtml;

        // --- Encounter History (Full Width, AutoPvP-style cards) ---
        let encHtml = '';
        if (history.encounters.length === 0) {
            encHtml = '<div style="font-size:12px; color:#8a80a0; text-align:center; padding:10px;">No encounters recorded yet.</div>';
        } else {
            for (const enc of history.encounters) {
                const monsterInfo = MONSTERS[enc.dataName];
                const displayName = monsterInfo?.displayName || enc.dataName;
                const imgSrc = monsterInfo?.img ? `https://demonicscans.org/${monsterInfo.img}` : '';
                const statusClass = enc.status === 'dead' ? 'af2-enc-status-dead' : 'af2-enc-status-alive';
                const statusLabel = enc.status === 'dead' ? 'Dead' : 'Alive';

                // Format attacks used
                const attacksList = Object.entries(enc.attacksUsed || {}).map(([name, count]) => `${name} x${count}`).join(', ') || 'None';
                const skillsList = Object.entries(enc.skillsUsed || {}).map(([name, count]) => `${name} x${count}`).join(', ') || 'None';

                encHtml += `
                <div class="af2-encounter-card">
                    <div class="af2-enc-left">
                        ${imgSrc ? `<img class="af2-enc-icon" src="${imgSrc}" alt="" onerror="this.style.display='none'">` : '<div class="af2-enc-icon" style="background:rgba(100,80,160,0.2);"></div>'}
                        <button class="af2-enc-view-btn" data-id="${enc.id}" title="Open in new tab">View</button>
                    </div>
                    <div class="af2-enc-right">
                        <div class="af2-enc-title">${displayName} <span class="${statusClass}">(${statusLabel})</span></div>
                        <div class="af2-enc-stat"><b>Damage Dealt:</b> ${(enc.dmg || 0).toLocaleString()}</div>
                        <div class="af2-enc-stat"><b>Hits Dealt:</b> ${enc.hits || 0}</div>
                        <div class="af2-enc-stat"><b>Attacks Used:</b> ${attacksList}</div>
                        <div class="af2-enc-stat"><b>Skills Used:</b> ${skillsList}</div>
                        <div class="af2-enc-stat"><b>Stamina Used:</b> ${(enc.stamina || 0).toLocaleString()}</div>
                        ${(enc.potionsUsed || 0) > 0 ? `<div class="af2-enc-stat"><b>Potions Used:</b> ${enc.potionsUsed}</div>` : ''}
                    </div>
                </div>`;
            }
        }
        encEl.innerHTML = encHtml;

        // Attach View button handlers
        encEl.querySelectorAll('.af2-enc-view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                window.open(`https://demonicscans.org/battle.php?id=${btn.dataset.id}`, '_blank');
            });
        });
    }

    // =========================================================================
    // --- Loot Results Modal ---
    // =========================================================================
    function showLootResultsModal(batchResults) {
        // Aggregate items from batch
        const aggregated = {};
        let totalExp = 0;
        let totalGold = 0;

        for (const result of batchResults) {
            if (!result.data) continue;
            const rewards = result.data.rewards || {};
            totalExp += rewards.exp || 0;
            totalGold += rewards.gold || 0;
            const items = result.data.items || [];
            for (const item of items) {
                const key = item.NAME || `Item #${item.ITEM_ID}`;
                if (!aggregated[key]) {
                    aggregated[key] = { qty: 0, imageUrl: item.IMAGE_URL || '', tier: item.TIER || 'COMMON' };
                }
                aggregated[key].qty += (item.QUANTITY || 1);
            }
        }

        const itemEntries = Object.entries(aggregated);
        if (itemEntries.length === 0 && totalExp === 0 && totalGold === 0) return; // Nothing to show

        const overlay = document.createElement('div');
        overlay.className = 'af2-loot-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'af2-loot-modal';

        let itemsHtml = '';
        for (const [name, info] of itemEntries) {
            const tierClass = `af2-tier-${(info.tier || 'common').toLowerCase()}`;
            itemsHtml += `
                <div class="af2-loot-modal-item">
                    ${info.imageUrl ? `<img src="${info.imageUrl}" alt="" onerror="this.style.display='none'">` : ''}
                    <span class="af2-lm-name ${tierClass}">${name}</span>
                    <span class="af2-lm-qty">×${info.qty}</span>
                </div>`;
        }

        modal.innerHTML = `
            <div class="af2-loot-modal-header">
                <span class="af2-loot-modal-title">🎁 Loot Results</span>
                <button class="af2-loot-modal-close">×</button>
            </div>
            <div class="af2-loot-modal-body">
                ${itemsHtml || '<div style="color:#8a80a0; font-size:12px; text-align:center; padding:10px;">No items dropped.</div>'}
            </div>
            <div class="af2-loot-modal-summary">
                <span class="af2-lms-exp">+${totalExp.toLocaleString()} EXP</span>
                <span class="af2-lms-gold">+${totalGold.toLocaleString()} Gold</span>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Modal dragging
        const modalHeader = modal.querySelector('.af2-loot-modal-header');
        let mDragging = false, mStartX, mStartY, mInitX, mInitY;
        modalHeader.onpointerdown = (e) => {
            if (e.target.closest('.af2-loot-modal-close')) return;
            mDragging = true;
            mStartX = e.clientX; mStartY = e.clientY;
            const rect = modal.getBoundingClientRect();
            mInitX = rect.left; mInitY = rect.top;
            modal.style.position = 'fixed';
            modal.style.margin = '0';
            modal.style.left = mInitX + 'px';
            modal.style.top = mInitY + 'px';
            modalHeader.setPointerCapture(e.pointerId);
        };
        modalHeader.onpointermove = (e) => {
            if (!mDragging) return;
            modal.style.left = (mInitX + e.clientX - mStartX) + 'px';
            modal.style.top = (mInitY + e.clientY - mStartY) + 'px';
        };
        const stopModalDrag = (e) => {
            if (!mDragging) return;
            mDragging = false;
            try { modalHeader.releasePointerCapture(e.pointerId); } catch(err){}
        };
        modalHeader.onpointerup = stopModalDrag;
        modalHeader.onpointercancel = stopModalDrag;

        // Close
        modal.querySelector('.af2-loot-modal-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    }

    // =========================================================================
    // --- API & Fetching ---
    // =========================================================================
    async function prefetchWaves(mode = 'alive') {
        const isFarm = (mode === 'alive');
        document.cookie = `hide_dead_monsters=${isFarm ? '1' : '0'}; path=/`;

        let tempMonsters = {};
        const wavesToScan = globalConfig.activeWaves || Object.keys(WAVES);

        for (const waveQuery of wavesToScan) {
            tempMonsters[waveQuery] = {};
            try {
                const html = await fetch(`https://demonicscans.org/active_wave.php?${waveQuery}`).then(r => r.text());
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');

                const cards = doc.querySelectorAll('.monster-card');
                cards.forEach(card => {
                    const id = card.dataset.monsterId;
                    const dataName = card.dataset.name;
                    if (!id || !dataName) return;

                    // For dead mode: unconditionally include everything on the dead page
                    if (isFarm && card.dataset.dead === '1') return;
                    if (!isFarm && card.dataset.dead !== '1') return;

                    const displayName = card.querySelector('h3')?.textContent?.trim() || MONSTERS[dataName]?.displayName || dataName;
                    const imgEl = card.querySelector('img.monster-img');
                    const img = imgEl?.getAttribute('src') || (MONSTERS[dataName]?.img ? `https://demonicscans.org/${MONSTERS[dataName].img}` : '');

                    if (!tempMonsters[waveQuery][dataName]) {
                        tempMonsters[waveQuery][dataName] = { dataName, name: displayName, img, ids: [] };
                    }
                    tempMonsters[waveQuery][dataName].ids.push({ id });
                });
            } catch (e) {
                console.error("AutoFarm 2.0: Error prefetching wave:", waveQuery, e);
            }
        }

        if (isFarm) {
            liveMonsters = tempMonsters;
            renderFarmMonsters();
        } else {
            deadMonsters = tempMonsters;
            renderLootMonsters();
            appendStatus(`Found ${Object.values(tempMonsters).reduce((s, wg) => s + Object.values(wg).reduce((s2, m) => s2 + m.ids.length, 0), 0)} dead monster(s).`, 'good', 'af2-loot-status');
        }
    }

    async function prefetchTargetStats(enemyId) {
        try {
            const html = await fetch(`https://demonicscans.org/battle.php?id=${enemyId}`).then(r => r.text());
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            const hpEl = doc.querySelector('#hpText');
            const dmgEl = doc.querySelector('#yourDamageValue');
            const staminaEl = doc.querySelector('#stamina_span');

            return {
                hp: hpEl ? Number(hpEl.textContent.replace(/[^0-9]/g, '')) : null,
                dmg: dmgEl ? Number(dmgEl.textContent.replace(/[^0-9]/g, '')) : 0,
                currentStamina: staminaEl ? Number(staminaEl.textContent.replace(/[^0-9]/g, '')) : 999,
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
                    headers: { "content-type": "application/x-www-form-urlencoded" },
                    referrer: `https://demonicscans.org/battle.php?id=${enemyId}`,
                    body: `monster_id=${enemyId}${uIdStr}`,
                    method: "POST",
                    mode: "cors",
                    credentials: "include"
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
            if (!demonCookie) return { success: false, data: null };

            const res = await fetch("https://demonicscans.org/loot.php", {
                headers: { "content-type": "application/x-www-form-urlencoded" },
                referrer: `https://demonicscans.org/battle.php?id=${monsterId}`,
                body: `monster_id=${monsterId}&user_id=${demonCookie}`,
                method: "POST",
                mode: "cors",
                credentials: "include"
            });
            const data = await res.json().catch(() => null);
            if (data && data.status === 'success') {
                const rewards = data.rewards || {};
                trackLoot(rewards.exp || 0, rewards.gold || 0, data.items || []);
                return { success: true, data };
            }
            return { success: res.ok, data };
        } catch(e) {
            return { success: false, data: null };
        }
    }

    async function usePotion(invId, qty = 1) {
        try {
            const body = qty > 1 ? `inv_id=${invId}&qty=${qty}` : `inv_id=${invId}`;
            await fetch("https://demonicscans.org/use_item.php", {
                headers: { "content-type": "application/x-www-form-urlencoded" },
                referrer: document.location.href,
                body: body,
                method: "POST",
                mode: "cors",
                credentials: "include"
            });
            return true;
        } catch(e) {
            return false;
        }
    }

    // =========================================================================
    // --- Potion Logic ---
    // =========================================================================
    function getPotionQtyFromPage(invId) {
        const el = document.querySelector(`#pqty_${invId}`);
        return el ? parseInt(el.textContent) || 0 : 999; // If element not on page, assume plenty
    }

    async function checkAndUsePotion(resource, currentValue, maxValue, actionCost = 0) {
        if (!globalConfig.potionsEnabled) return false;

        const relevantPotions = Object.entries(POTIONS).filter(([, p]) => p.resource === resource);
        const pct = maxValue > 0 ? (currentValue / maxValue) * 100 : (currentValue > 0 ? 100 : 0);

        for (const [key, pot] of relevantPotions) {
            const pc = globalConfig.potionConfig[key];
            if (!pc || !pc.enabled) continue;

            const qty = getPotionQtyFromPage(pot.invId);
            if (qty <= (pc.minReserve || 0)) continue;

            let shouldUse = false;

            // Check threshold (0% means only when at 0)
            if (pc.threshold === 0) {
                if (currentValue <= 0) shouldUse = true;
            } else {
                if (pct <= pc.threshold) shouldUse = true;
            }

            // Check action prerequisite (only for stamina/mp)
            if (!shouldUse && pc.useForAction && actionCost > 0 && currentValue < actionCost) {
                shouldUse = true;
            }

            if (shouldUse) {
                appendStatus(`Using ${pot.name}...`, 'info');
                const success = await usePotion(pot.invId);
                if (success) {
                    appendStatus(`${pot.name} used successfully!`, 'good');
                    recordPotionUsed();
                    // Update displayed qty
                    const qtyEl = document.querySelector(`#pqty_${pot.invId}`);
                    if (qtyEl) qtyEl.textContent = Math.max(0, qty - 1);
                    return true;
                }
            }
        }
        return false;
    }

    // =========================================================================
    // --- Combat Logic ---
    // =========================================================================
    async function attackEnemy(enemyId, dataName) {
        const conf = getMonsterConf(dataName);
        const attack = ATTACKS[conf.attackId] || ATTACKS['0'];
        const skill = conf.skillId ? SKILLS[conf.skillId] : null;

        let stats = await prefetchTargetStats(enemyId);

        // Start tracking this encounter
        startEncounter(enemyId, dataName);

        // Stamina check with potion support
        if (stats.currentStamina < attack.staminaCost) {
            const potionUsed = await checkAndUsePotion('stamina', stats.currentStamina, 1430, attack.staminaCost);
            if (!potionUsed) {
                appendStatus(`Skipping ${MONSTERS[dataName]?.displayName || dataName}: Not enough stamina (${stats.currentStamina}/${attack.staminaCost})`, 'bad');
                finalizeEncounter('alive');
                return null;
            }
            await sleep(500);
            stats = await prefetchTargetStats(enemyId);
        }

        // Safety checks
        if (stats.hp === null || stats.hp < conf.dmgThreshold * 2) {
            finalizeEncounter('alive');
            return null;
        }
        if (stats.dmg >= conf.dmgThreshold) {
            finalizeEncounter('alive');
            return { action: 'threshold' };
        }

        const joined = await joinBattle(enemyId);
        if (!joined) {
            finalizeEncounter('alive');
            return null;
        }

        while (isRunning) {
            // Stamina check
            if (stats.currentStamina < attack.staminaCost) {
                const potionUsed = await checkAndUsePotion('stamina', stats.currentStamina, 1430, attack.staminaCost);
                if (!potionUsed) {
                    appendStatus(`Out of stamina for ${MONSTERS[dataName]?.displayName || dataName}`, 'bad');
                    if (globalConfig.soundStaminaOut) playThunder();
                    finalizeEncounter('alive');
                    return null;
                }
                await sleep(500);
                stats = await prefetchTargetStats(enemyId);
                continue;
            }

            try {
                // Execute support skill first if configured
                if (skill && skill.type === 'support') {
                    const mpUsed = skill.mpCost;
                    await fetch("https://demonicscans.org/damage.php", {
                        headers: { "content-type": "application/x-www-form-urlencoded" },
                        referrer: `https://demonicscans.org/battle.php?id=${enemyId}`,
                        body: `monster_id=${enemyId}&skill_id=${conf.skillId}&stamina_cost=1`,
                        method: "POST",
                        mode: "cors",
                        credentials: "include"
                    }).then(i => i.json()).catch(() => null);
                    recordHit(null, skill.name, 0, 0, mpUsed);
                    await randomDelay(300, 500);
                }

                // Execute attack skill if configured (separate from support)
                if (skill && skill.type === 'attack' && conf.skillId !== '') {
                    const mpUsed = skill.mpCost;
                    const skillResult = await fetch("https://demonicscans.org/damage.php", {
                        headers: { "content-type": "application/x-www-form-urlencoded" },
                        referrer: `https://demonicscans.org/battle.php?id=${enemyId}`,
                        body: `monster_id=${enemyId}&skill_id=${conf.skillId}&stamina_cost=1`,
                        method: "POST",
                        mode: "cors",
                        credentials: "include"
                    }).then(i => i.json());

                    if (skillResult.status === "error") {
                        if (skillResult.message?.includes("Monster is already dead.")) {
                            recordHit(null, skill.name, 0, 0, mpUsed);
                            finalizeEncounter('dead');
                            return { action: 'dead' };
                        }
                    } else {
                        recordHit(null, skill.name, skillResult.totaldmgdealt || 0, 0, mpUsed);
                        if (skillResult.hp?.value <= 0) { finalizeEncounter('dead'); return { action: 'dead' }; }
                        if (skillResult.totaldmgdealt >= conf.dmgThreshold) { finalizeEncounter('alive'); return { action: 'threshold' }; }
                    }
                    await randomDelay(300, 500);
                }

                // Execute main attack
                const result = await fetch("https://demonicscans.org/damage.php", {
                    headers: { "content-type": "application/x-www-form-urlencoded" },
                    referrer: `https://demonicscans.org/battle.php?id=${enemyId}`,
                    body: `monster_id=${enemyId}&skill_id=${conf.attackId}&stamina_cost=${attack.staminaCost}`,
                    method: "POST",
                    mode: "cors",
                    credentials: "include"
                }).then(i => i.json());

                if (result.status === "error") {
                    if (result.message?.includes("Monster is already dead.")) {
                        recordHit(attack.name, null, 0, attack.staminaCost, 0);
                        finalizeEncounter('dead');
                        return { action: 'dead' };
                    }
                    if (result.message?.includes("inactivity")) { await joinBattle(enemyId); continue; }
                    if (result.message?.includes("Not enough stamina.")) {
                        if (globalConfig.soundStaminaOut) playThunder();
                        finalizeEncounter('alive');
                        return null;
                    }
                    await randomDelay(1000, 1100);
                    continue;
                }

                // Track successful attack
                recordHit(attack.name, null, result.totaldmgdealt || 0, attack.staminaCost, 0);

                // HP potion check (retaliation damage)
                if (result.retaliation?.damage > 0 && result.retaliation?.user_hp_after > 0) {
                    await checkAndUsePotion('hp', result.retaliation.user_hp_after, 21150);
                }

                // Check end conditions
                if (result.hp?.value <= 0) { finalizeEncounter('dead'); return { action: 'dead' }; }
                if (result.totaldmgdealt >= conf.dmgThreshold) { finalizeEncounter('alive'); return { action: 'threshold' }; }
                if (result.hp?.value <= (conf.dmgThreshold * 2)) { finalizeEncounter('alive'); return { action: 'threshold' }; }
                if (result.stamina < attack.staminaCost) {
                    stats.currentStamina = result.stamina;
                    continue; // Will trigger stamina check at top of loop
                }

                stats.currentStamina = result.stamina;
                await randomDelay(1000, 1100);

            } catch (e) {
                await randomDelay(1000, 1100);
            }
        }
        finalizeEncounter('alive');
        return null;
    }

    // =========================================================================
    // --- Main Farm Loop ---
    // =========================================================================
    async function loop() {
        if (!isRunning) return;

        appendStatus("Scanning alive waves...", 'info');
        await prefetchWaves('alive');

        // Flatten and sort active monsters by priority (lower number = higher priority)
        let targetInstances = [];
        const wavesToScan = globalConfig.activeWaves || Object.keys(WAVES);
        for (const waveQuery of wavesToScan) {
            const waveGroup = liveMonsters[waveQuery];
            if (!waveGroup) continue;

            for (const [dataName, m] of Object.entries(waveGroup)) {
                const conf = getMonsterConf(dataName);
                if (!conf.enabled) continue;
                const prio = conf.priority ?? 10;
                for (const inst of m.ids) {
                    targetInstances.push({ id: inst.id, dataName, priority: prio });
                }
            }
        }

        targetInstances.sort((a, b) => a.priority - b.priority);

        if (targetInstances.length === 0) {
            appendStatus("No enabled targets found.", 'info');
        }

        for (const target of targetInstances) {
            if (!isRunning) break;
            appendStatus(`Attacking ${MONSTERS[target.dataName]?.displayName || target.dataName}`, 'action');

            const result = await attackEnemy(target.id, target.dataName);

            if (result && result.action === 'dead') {
                appendStatus(`${MONSTERS[target.dataName]?.displayName || target.dataName} killed!`, 'good');
            } else if (result && result.action === 'threshold') {
                appendStatus(`Threshold reached for ${MONSTERS[target.dataName]?.displayName || target.dataName}`, 'info');
            } else if (result === null) {
                if (!isRunning) break;
                if (globalConfig.keepCheckingStamina) {
                    appendStatus(`Stamina exhausted. Will retry in ${globalConfig.staminaCheckInterval} min...`, 'info');
                    if (globalConfig.soundStaminaOut) playThunder();
                    await sleep(globalConfig.staminaCheckInterval * 60000);
                    if (isRunning) {
                        currentLoopTimeout = setTimeout(loop, 1000);
                    }
                    return;
                }
            }

            await randomDelay(1000, 1100);
        }

        if (isRunning) {
            currentLoopTimeout = setTimeout(loop, 5000);
        }
    }

    // =========================================================================
    // --- Batch Looting ---
    // =========================================================================
    async function doBatchLoot(mode, limit = Infinity) {
        if (isLooting) {
            appendStatus("Already looting...", 'bad', 'af2-loot-status');
            return;
        }

        isLooting = true;

        // Refresh dead monsters first
        await prefetchWaves('dead');

        let toLoot = [];
        for (const waveGroup of Object.values(deadMonsters)) {
            for (const [dataName, m] of Object.entries(waveGroup)) {
                if (mode === 'selected' && !globalConfig.lootSelectedMonsters.includes(dataName)) continue;
                for (const inst of m.ids) {
                    toLoot.push({ id: inst.id, dataName });
                }
            }
        }

        // Apply limit for "Loot X"
        if (limit < Infinity && toLoot.length > limit) {
            toLoot = toLoot.slice(0, limit);
        }

        if (toLoot.length === 0) {
            appendStatus("No dead monsters match your selection.", 'info', 'af2-loot-status');
            isLooting = false;
            return;
        }

        appendStatus(`Looting ${toLoot.length} monster(s)...`, 'action', 'af2-loot-status');

        let successCount = 0;
        const batchResults = [];

        for (let i = 0; i < toLoot.length; i++) {
            const target = toLoot[i];
            appendStatus(`[${i+1}/${toLoot.length}] Looting ${MONSTERS[target.dataName]?.displayName || target.dataName}...`, 'action', 'af2-loot-status');
            const res = await apiLoot(target.id);
            batchResults.push(res);
            if (res.success) {
                successCount++;
                if (res.data?.items?.length > 0) {
                    const itemNames = res.data.items.map(it => it.NAME).join(', ');
                    appendStatus(`Got: ${itemNames}`, 'good', 'af2-loot-status');
                }
            }
            await randomDelay(1000, 1100);
        }

        appendStatus(`Done! Looted: ${successCount}/${toLoot.length}`, 'good', 'af2-loot-status');
        isLooting = false;

        // Show results modal
        showLootResultsModal(batchResults.filter(r => r.success));

        // Refresh
        await prefetchWaves('dead');
    }

    // =========================================================================
    // --- Lock Manager (State Machine from AutoPvP 2.0) ---
    // =========================================================================
    async function initLockManager() {
        let warnBox = null;
        let isStandby = false;

        async function showStandby() {
            if (isStandby) return;
            isStandby = true;
            document.getElementById('af2-container')?.remove();
            isRunning = false;

            const saved = await GM.getValue("veyra_af2_config", null);
            const tempConfig = { ...DEFAULT_CONFIG, ...(saved || {}) };
            if (tempConfig.showStandbyWarning && !warnBox) {
                warnBox = document.createElement('div');
                warnBox.innerHTML = `⚠️ <b>AutoFarm 2.0 Standby</b><br>Another tab is active.`;
                Object.assign(warnBox.style, {
                    position: 'fixed', top: '10px', right: '10px', background: 'rgba(100,60,180,0.9)',
                    color: 'white', padding: '10px', borderRadius: '6px', zIndex: '999999',
                    fontFamily: 'monospace', fontSize: '12px', pointerEvents: 'none', boxShadow: '0 4px 10px rgba(0,0,0,0.5)'
                });
                document.body.appendChild(warnBox);
            }
        }

        function hideStandby() {
            if (!isStandby) return;
            isStandby = false;
            if (warnBox) { warnBox.remove(); warnBox = null; }
        }

        async function checkLock() {
            let master = await GM.getValue("veyra_af2_master", null);
            if (!master) master = { id: '', time: 0 };
            const now = Date.now();

            if (isMaster) {
                if (master.id !== myTabId && master.id !== '') {
                    isMaster = false;
                    console.warn("AutoFarm 2.0: Lost master lock! Stepping down.");
                    showStandby();
                } else {
                    await GM.setValue("veyra_af2_master", { id: myTabId, time: now });
                }
            } else {
                if (now - master.time > 3000 || master.id === myTabId || master.id === '') {
                    await GM.setValue("veyra_af2_master", { id: myTabId, time: now });
                    isMaster = true;
                    hideStandby();

                    isRunning = await GM.getValue("veyra_af2_running", false);
                    await setupUI();
                    if (isRunning) loop();
                } else {
                    showStandby();
                }
            }
        }

        await checkLock();
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
        errBox.innerHTML = `<b>AutoFarm 2.0 Fatal Crash:</b><br><br>${err.message}<br><br>${err.stack}`;
        document.body.appendChild(errBox);
        console.error("AutoFarm 2.0 Error:", err);
    }
})();
