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

    getData() {
        return {
            lockpicks: 5
        };
    }

    constructor(options) {
        super(options);
        
        // Настройки сложности
        this.difficultySettings = { very_easy: 60, easy: 45, medium: 30, hard: 15, very_hard: 5 };
        this.difficultyWearSpeed = { very_easy: 0.8, easy: 1.5, medium: 2.5, hard: 4.5, very_hard: 8.0 };
        this.currentDifficulty = "medium";

        // Пути к звукам-плейсхолдерам
        this.soundPaths = {
            scratch: "modules/skyrim-lockpicking/sounds/scratch.ogg",
            break: "modules/skyrim-lockpicking/sounds/break.ogg",
            unlock: "modules/skyrim-lockpicking/sounds/unlock.ogg"
        };
        this.scratchSoundRef = null; // Ссылка на играющий звук

        // Состояние игры
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

        this.debris = {
            part1: { x: 0, y: 0, vx: 0, vy: 0, rot: 0, vRot: 0 },
            part2: { x: 0, y: 0, vx: 0, vy: 0, rot: 0, vRot: 0 }
        };

        this.keysPressed = { KeyA: false, KeyD: false, ArrowLeft: false, ArrowRight: false };
        
        // Привязка контекста для событий
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onKeyUp = this._onKeyUp.bind(this);
        this._gameLoop = this._gameLoop.bind(this);
        this.animationFrameId = null;
    }

    activateListeners(html) {
        super.activateListeners(html);
        
        this.canvas = html.find("#lockpicking-canvas")[0];
        this.ctx = this.canvas.getContext("2d");
        this.picksCountEl = html.find("#picks-count")[0];
        this.difficultySelect = html.find("#difficulty-select")[0];

        // Слушатели событий
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
        window.addEventListener("blur", () => this.clearKeys());

        // Запуск цикла
        this.animationFrameId = requestAnimationFrame(this._gameLoop);
    }

    close(options) {
        document.removeEventListener("keydown", this._onKeyDown);
        document.removeEventListener("keyup", this._onKeyUp);
        cancelAnimationFrame(this.animationFrameId);
        this.stopScratchSound();
        return super.close(options);
    }

    _onKeyDown(e) {
        if (this.pickState === "normal" && e.code in this.keysPressed) {
            this.keysPressed[e.code] = true;
        }
    }

    _onKeyUp(e) {
        if (e.code in this.keysPressed) this.keysPressed[e.code] = false;
    }

    clearKeys() {
        for (let key in this.keysPressed) this.keysPressed[key] = false;
        this.stopScratchSound();
    }

    // --- АУДИО ---
    async startScratchSound() {
        if (this.scratchSoundRef) return; // Уже играет
        // В Foundry воспроизводим файл циклом
        this.scratchSoundRef = true; // Блокировка от множественных вызовов
        AudioHelper.play({src: this.soundPaths.scratch, volume: 0.3, loop: true}, false).then(sound => {
            if (sound) this.scratchSoundRef = sound;
        });
    }

    stopScratchSound() {
        if (this.scratchSoundRef) {
            if (typeof this.scratchSoundRef.stop === "function") {
                this.scratchSoundRef.stop();
            }
            this.scratchSoundRef = null;
        }
    }

    playBreakSound() {
        AudioHelper.play({src: this.soundPaths.break, volume: 0.6, autoplay: true}, false);
    }

    playUnlockSound() {
        AudioHelper.play({src: this.soundPaths.unlock, volume: 0.6, autoplay: true}, false);
    }

    // --- ЛОГИКА ---
    _gameLoop() {
        this.updateLogic();
        this.drawCanvas();
        this.animationFrameId = requestAnimationFrame(this._gameLoop);
    }

    updateLogic() {
        if (this.pickState === "breaking") {
            this.animationTimer++;
            this.debris.part1.x += this.debris.part1.vx; this.debris.part1.y += this.debris.part1.vy; this.debris.part1.vy += 0.4; this.debris.part1.rot += this.debris.part1.vRot;
            this.debris.part2.x += this.debris.part2.vx; this.debris.part2.y += this.debris.part2.vy; this.debris.part2.vy += 0.4; this.debris.part2.rot += this.debris.part2.vRot;

            if (this.currentLockAngle > 0) this.currentLockAngle -= 2;

            if (this.animationTimer > 40) {
                if (this.lockpickCount <= 0) {
                    this.resetGame(false);
                } else {
                    this.startAppearingAnimation();
                }
            }
            return;
        }

        if (this.pickState === "appearing") {
            this.appearOffset -= 8;
            if (this.appearOffset <= 0) {
                this.appearOffset = 0; this.pickState = "normal"; this.clearKeys();
            }
            return;
        }

        const isTurning = this.keysPressed.KeyD || this.keysPressed.ArrowRight || this.keysPressed.KeyA || this.keysPressed.ArrowLeft;

        if (isTurning) {
            const halfZone = this.mockLockData.totalZoneWidth / 2;
            const minSafe = this.mockLockData.targetAngle - halfZone;
            const maxSafe = this.mockLockData.targetAngle + halfZone;

            if (this.currentPickAngle >= minSafe && this.currentPickAngle <= maxSafe) {
                this.stopScratchSound();
                if (this.currentLockAngle < 90) {
                    this.currentLockAngle += 1.5;
                } else {
                    this.currentLockAngle = 90;
                    this.playUnlockSound();
                    ui.notifications.info("Успех! Замок открыт.");
                    this.resetGame(false);
                }
            } else {
                const maxAllowedTurn = Math.max(0, 90 - Math.abs(this.currentPickAngle - this.mockLockData.targetAngle) * 3);
                
                if (this.currentLockAngle < maxAllowedTurn) {
                    this.stopScratchSound();
                    this.currentLockAngle += 1.5;
                } else {
                    this.currentLockAngle = maxAllowedTurn;
                    
                    this.startScratchSound();
                    this.currentPickAngle += (Math.random() - 0.5) * 5; 
                    this.pickDurability -= this.difficultyWearSpeed[this.currentDifficulty];

                    if (this.pickDurability <= 0) {
                        this.triggerBreakAnimation();
                    }
                }
            }
        } else {
            this.stopScratchSound();
            if (this.currentLockAngle > 0) {
                this.currentLockAngle -= 4;
                if (this.currentLockAngle < 0) this.currentLockAngle = 0;
            }
        }
    }

    triggerBreakAnimation() {
        this.stopScratchSound();
        this.playBreakSound();
        
        this.pickState = "breaking";
        this.animationTimer = 0;
        this.lockpickCount--;
        this.picksCountEl.innerText = this.lockpickCount;
        this.clearKeys();

        this.debris.part1 = { x: 50, y: 0, vx: (Math.random() - 0.4) * 2, vy: -Math.random() * 4 - 2, rot: 0, vRot: (Math.random() - 0.5) * 0.2 };
        this.debris.part2 = { x: 100, y: 0, vx: (Math.random() + 0.4) * 2, vy: -Math.random() * 3 - 4, rot: 0, vRot: (Math.random() - 0.5) * 0.3 };
    }

    startAppearingAnimation() {
        this.pickState = "appearing";
        this.pickDurability = 100;
        this.currentLockAngle = 0;
        this.currentPickAngle = 90;
        this.mockLockData.targetAngle = Math.floor(Math.random() * 160) + 10;
        this.appearOffset = 300;
        this.clearKeys();
    }

    drawCanvas() {
        const cx = this.canvas.width / 2;
        const cy = this.canvas.height / 2;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        let strokeColor = "#555";
        let shadowColor = "transparent";
        let shadowBlur = 0;

        if (this.pickState === "normal" && this.pickDurability < 100) {
            const stressFactor = (100 - this.pickDurability) / 100;
            const r = Math.floor(85 + (170 * stressFactor));
            const g = Math.floor(85 - (85 * stressFactor));
            const b = Math.floor(85 - (85 * stressFactor));
            strokeColor = `rgb(${r}, ${g}, ${b})`;
            shadowColor = `rgba(255, 0, 0, ${stressFactor * 0.6})`;
            shadowBlur = stressFactor * 15;
        }

        // Замок
        this.ctx.save(); 
        this.ctx.translate(cx, cy); 
        this.ctx.rotate(this.currentLockAngle * Math.PI / 180);
        
        this.ctx.beginPath(); this.ctx.arc(0, 0, 90, 0, 2 * Math.PI);
        this.ctx.fillStyle = "#333"; this.ctx.fill();
        this.ctx.lineWidth = 6; this.ctx.strokeStyle = strokeColor; this.ctx.shadowBlur = shadowBlur; this.ctx.shadowColor = shadowColor; this.ctx.stroke();
        this.ctx.shadowBlur = 0;
        this.ctx.beginPath(); this.ctx.arc(0, 0, 60, 0, 2 * Math.PI);
        this.ctx.fillStyle = "#222"; this.ctx.fill();
        this.ctx.lineWidth = 3; this.ctx.strokeStyle = "#111"; this.ctx.stroke();
        this.ctx.fillStyle = "#050505"; this.ctx.fillRect(-5, -25, 10, 50);
        this.ctx.restore();

        // Отмычка
        if (this.pickState === "breaking") {
            this.ctx.save(); this.ctx.translate(cx, cy); this.ctx.rotate(-this.currentPickAngle * Math.PI / 180); this.ctx.translate(this.debris.part1.x, this.debris.part1.y); this.ctx.rotate(this.debris.part1.rot);
            this.ctx.beginPath(); this.ctx.moveTo(0, 0); this.ctx.lineTo(50, 0); this.ctx.lineWidth = 4; this.ctx.strokeStyle = "#d1d1d1"; this.ctx.stroke(); this.ctx.restore();

            this.ctx.save(); this.ctx.translate(cx, cy); this.ctx.rotate(-this.currentPickAngle * Math.PI / 180); this.ctx.translate(this.debris.part2.x, this.debris.part2.y); this.ctx.rotate(this.debris.part2.rot);
            this.ctx.beginPath(); this.ctx.moveTo(0, 0); this.ctx.lineTo(70, 0); this.ctx.lineTo(75, -8); this.ctx.lineWidth = 4; this.ctx.strokeStyle = "#d1d1d1"; this.ctx.stroke(); this.ctx.restore();
        } else {
            this.ctx.save(); this.ctx.translate(cx, cy); this.ctx.rotate(-this.currentPickAngle * Math.PI / 180); this.ctx.translate(this.appearOffset, 0);
            this.ctx.beginPath(); this.ctx.moveTo(0, 0); this.ctx.lineTo(140, 0); this.ctx.lineWidth = 4; this.ctx.strokeStyle = "#d1d1d1"; this.ctx.lineCap = "round"; this.ctx.lineTo(145, -8); this.ctx.stroke(); this.ctx.restore();
        }
    }

    resetGame(keepCount) {
        this.stopScratchSound();
        if (!keepCount) {
            this.lockpickCount = 5;
            if (this.picksCountEl) this.picksCountEl.innerText = this.lockpickCount;
        }
        this.currentPickAngle = 90; 
        this.currentLockAngle = 0; 
        this.pickDurability = 100; 
        this.pickState = "normal";
        this.mockLockData.targetAngle = Math.floor(Math.random() * 160) + 10;
        this.mockLockData.totalZoneWidth = this.difficultySettings[this.currentDifficulty];
        this.clearKeys();
    }
}

// Регистрация макроса/команды для запуска окна
Hooks.once("ready", () => {
    // В консоли Foundry или в макросе (типа Script) можно будет вызвать: 
    // new SkyrimLockpickingApp().render(true);
    window.SkyrimLockpickingApp = SkyrimLockpickingApp;
});