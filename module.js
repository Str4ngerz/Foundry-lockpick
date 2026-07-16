class SkyrimLockpickingApp extends Application {
    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            id: "skyrim-lockpicking-window",
            title: "Взлом замка",
            template: "modules/skyrim-lockpicking/templates/lockpick.hbs",
            width: 480,
            height: 600,
            resizable: false
        });
    }

    constructor(options) {
        super(options);
        
        this.difficultySettings = { very_easy: 60, easy: 45, medium: 30, hard: 15, very_hard: 5 };
        this.difficultyWearSpeed = { very_easy: 0.8, easy: 1.5, medium: 2.5, hard: 4.5, very_hard: 8.0 };
        this.currentDifficulty = "medium";

        this.soundPaths = {
            scratch: "modules/skyrim-lockpicking/sounds/scratch.ogg",
            break: "modules/skyrim-lockpicking/sounds/break.ogg",
            unlock: "modules/skyrim-lockpicking/sounds/unlock.ogg"
        };
        this.scratchSoundRef = null;

        this.currentPickAngle = 90;
        this.currentLockAngle = 0;
        this.pickDurability = 100;
        this.lockpickCount = 5;
        this.pickState = "normal";
        this.animationTimer = 0;
        this.appearOffset = 0;
        
        this.mockLockData = {
            targetAngle: Math.floor(Math.random() * 160) + 10,
            totalZoneWidth: this.difficultySettings[this.currentDifficulty]
        };

        this.debris = { part1: {}, part2: {} };
        this.keysPressed = { KeyA: false, KeyD: false, ArrowLeft: false, ArrowRight: false };
        
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onKeyUp = this._onKeyUp.bind(this);
        this._gameLoop = this._gameLoop.bind(this);
        this.animationFrameId = null;
    }

    // Добавляем метод для инициализации элементов после рендера
    activateListeners(html) {
        super.activateListeners(html);
        
        // Используем setTimeout, чтобы DOM гарантированно существовал
        setTimeout(() => {
            this.canvas = html.find("#lockpicking-canvas")[0];
            this.picksCountEl = html.find("#picks-count")[0];
            this.difficultySelect = html.find("#difficulty-select")[0];

            if (!this.canvas) return; // Защита от ошибки null
            this.ctx = this.canvas.getContext("2d");

            this.difficultySelect.addEventListener("change", (e) => {
                this.currentDifficulty = e.target.value;
                this.resetGame(false);
            });

            this.canvas.addEventListener("mousemove", (e) => {
                if (this.currentLockAngle > 0 || this.pickState !== "normal") return;
                const rect = this.canvas.getBoundingClientRect();
                const x = e.clientX - rect.left - rect.width / 2;
                const y = e.clientY - rect.top - rect.height / 2;
                
                let angle = Math.atan2(-y, x) * (180 / Math.PI);
                if (angle < 0) angle = (x >= 0) ? 0 : 180;
                this.currentPickAngle = angle;
            });

            document.addEventListener("keydown", this._onKeyDown);
            document.addEventListener("keyup", this._onKeyUp);
            
            // Запуск цикла
            this.animationFrameId = requestAnimationFrame(this._gameLoop);
        }, 100);
    }

    _gameLoop() {
        if (!this.canvas) return; // Прекращаем цикл, если окно закрыто
        this.updateLogic();
        this.drawCanvas();
        this.animationFrameId = requestAnimationFrame(this._gameLoop);
    }

    // Остальные методы (updateLogic, drawCanvas, resetGame и т.д.) 
    // остаются такими же, как в предыдущем примере...
    
    close(options) {
        document.removeEventListener("keydown", this._onKeyDown);
        document.removeEventListener("keyup", this._onKeyUp);
        cancelAnimationFrame(this.animationFrameId);
        this.stopScratchSound();
        return super.close(options);
    }

    _onKeyDown(e) { if (this.pickState === "normal" && e.code in this.keysPressed) this.keysPressed[e.code] = true; }
    _onKeyUp(e) { if (e.code in this.keysPressed) this.keysPressed[e.code] = false; }
    
    stopScratchSound() {
        if (this.scratchSoundRef && typeof this.scratchSoundRef.stop === "function") {
            this.scratchSoundRef.stop();
        }
        this.scratchSoundRef = null;
    }
    
    // Добавьте сюда ваши методы обновления логики и отрисовки из предыдущего кода
}

Hooks.once("ready", () => {
    window.SkyrimLockpickingApp = SkyrimLockpickingApp;
});