<div align="center">
  <h1>⚔️ VeyraScripts</h1>
  <p>A collection of advanced, highly-optimized Tampermonkey scripts for automated gameplay and enhanced UI on <a href="https://demonicscans.org">DemonicScans.org</a>.</p>
</div>

<hr>

## 📁 Repository Structure

```text
# VeyraScripts
├── libs/
│   └── AntiThrottle.js
├── src/
│   ├── AutoCastle.user.js
│   ├── AutoFarm.user.js
│   ├── AutoPvP.user.js
│   └── GetSkillsData.user.js
├── .gitignore
├── eslint.config.mjs
├── package.json
└── README.md
```

## 📜 Available UserScripts

All of the main UserScripts are located in the `src` folder.

| Script Name | Author | Collaborators | Summary | Install Link |
|-------------|--------|---------|--------------|
| **AutoCastle** | Slayfer | \[ATOMIC] b07_ark.exe | Automates Castle event farming with background execution and custom delays. | [Install AutoCastle](https://raw.githubusercontent.com/slayfer-dev/VeyraScripts/refs/heads/main/src/AutoCastle.user.js) |
| **AutoFarm** | Slayfer | \[ATOMIC] b07_ark.exe | Automates farming and mob looting with an advanced history tracker. | [Install AutoFarm](https://raw.githubusercontent.com/slayfer-dev/VeyraScripts/refs/heads/main/src/AutoFarm.user.js) |
| **AutoPvP** | Slayfer | \[ATOMIC] b07_ark.exe | Automates solo PvP matchmaking with class filters and smart memory loadouts. | [Install AutoPvP](https://raw.githubusercontent.com/slayfer-dev/VeyraScripts/refs/heads/main/src/AutoPvP.user.js) |
| **GetSkillsData** | Slayfer | \[ATOMIC] b07_ark.exe | Scrapes player combat skills and attributes into a gorgeous floating UI. | [Install GetSkillsData](https://raw.githubusercontent.com/slayfer-dev/VeyraScripts/refs/heads/main/src/GetSkillsData.user.js) |

---

## 🛠️ Installation & Usage

To install any of these scripts, you will need a userscript manager like **[Tampermonkey](https://www.tampermonkey.net/)**.

1. **Install Tampermonkey** on your browser.
2. Click on the Install Links in the table above to install the script directly into your browser.
3. Tampermonkey will prompt you to install. Click **Install**.
4. Visit `demonicscans.org` and the scripts will load automatically!

> [!NOTE]
> All scripts use `@updateURL` and `@downloadURL` headers to automatically pull the latest updates directly from this repository.

---

## ⚡ Background Execution (Anti-Throttle)

Modern browsers aggressively throttle JavaScript timers when tabs are in the background (like `setTimeout` and `setInterval`).

To bypass this and keep your auto-farming scripts running at 100% speed even when minimized, we use the `AntiThrottle.js` library located in the `libs` folder.

**How it works:**
The scripts use a `@require` tag to inject a background Web Worker that overrides the default browser timers. This ensures precision timing regardless of tab visibility.

---

## 👨‍💻 Development

This project uses modern, standard tools to ensure high-quality, bug-free code.

- **Linting:** Configured with the latest ESLint Flat Config (`eslint.config.mjs`).
- **Formatting:** Prettier is integrated natively to maintain consistent code style.

### Setup Instructions
If you want to contribute or modify the scripts locally:
1. Clone the repository: `git clone https://github.com/slayfer-dev/VeyraScripts.git`
2. Install dependencies: `npm install`
3. Make your changes in the `src/` directory.

### Linting Commands
Run the following npm scripts to check your code:
- Check for errors: `npx eslint .`
- Automatically fix errors: `npx eslint . --fix`
- Format code: `npx prettier --write .`