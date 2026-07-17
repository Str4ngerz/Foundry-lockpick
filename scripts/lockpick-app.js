/**
 * Skyrim Lockpicking - core minigame Application
 * Порт логики из авторского HTML-прототипа в FoundryVTT Application.
 */
window.SkyrimLockpicking = window.SkyrimLockpicking || {};

(() => {
  const MODULE_ID = "skyrim-lockpicking";
  SkyrimLockpicking.MODULE_ID = MODULE_ID;

  // Настройки сложности - идентичны прототипу
  const difficultySettings = { very_easy: 60, easy: 45, medium: 30, hard: 15, very_hard: 5 };
  const difficultyWearSpeed = { very_easy: 0.8, easy: 1.5, medium: 2.5, hard: 4.5, very_hard: 8.0 };
  SkyrimLockpicking.difficultySettings = difficultySettings;
  SkyrimLockpicking.difficultyWearSpeed = difficultyWearSpeed;
  SkyrimLockpicking.difficultyLabels = {
    very_easy: "Очень просто",
    easy: "Просто",
    medium: "Средне",
    hard: "Сложно",
    very_hard: "Очень сложно"
  };

  // Пути к звукам-плейсхолдерам. Просто положите свои mp3 в modules/skyrim-lockpicking/sounds/
  // с этими именами - код ничего больше менять не потребует.
  const SOUND_PATHS = {
    scratch: `modules/${MODULE_ID}/sounds/scratch.mp3`,
    brk: `modules/${MODULE_ID}/sounds/break.mp3`,
    success: `modules/${MODULE_ID}/sounds/success.mp3`
  };

  class LockpickApp extends Application {
    /**
     * @param {object} opts
     * @param {Item|Actor} opts.target       - документ с флагом pickable, который взламывается
     * @param {Actor|null} opts.actingActor   - актор, чьи отмычки тратятся / кому засчитывается успех
     * @param {string} opts.difficulty        - разрешённый ключ сложности (very_easy..very_hard)
     * @param {Item} opts.lockpickItem         - предмет-отмычка, уже найденный и проверенный вызывающей стороной
     */
    constructor({ target, actingActor, difficulty, lockpickItem }, options = {}) {
      super(options);
      this.target = target;
      this.actingActor = actingActor || null;
      this.difficulty = difficulty in difficultySettings ? difficulty : "medium";

      // Состояние отмычек - launchFor() в main.js уже гарантирует, что
      // lockpickItem существует и его количество > 0, до открытия окна.
      this.lockpickItem = lockpickItem ?? null;
      this.unlimitedPicks = false;
      this.lockpickCount = this.lockpickItem?.system?.quantity ?? 1;

      // Бонус от навыка "Ловкость рук" подконтрольного персонажа.
      // Если у актора нет такого навыка (например, у ГМ без персонажа) - 0 (дефолт).
      const skillInfo = SkyrimLockpicking.computeSkillBonus(this.actingActor);
      this.skillMod = skillInfo.mod;
      this.skillBonus = skillInfo.bonus;
      this.baseZoneWidth = difficultySettings[this.difficulty];
      // Чем выше бонус, тем медленнее снашивается отмычка
      this.wearMultiplier = Math.max(0.2, 1 - this.skillBonus);

      // Игровое состояние (портировано из прототипа)
      this.mockLockData = {
        targetAngle: Math.floor(Math.random() * 160) + 10,
        totalZoneWidth: Math.min(170, this.baseZoneWidth * (1 + this.skillBonus))
      };
      this.currentPickAngle = 90;
      this.currentLockAngle = 0;
      this.pickDurability = 100;
      this.pickState = "normal";
      this.animationTimer = 0;
      this.appearOffset = 0;
      this.debris = {
        part1: { x: 0, y: 0, vx: 0, vy: 0, rot: 0, vRot: 0 },
        part2: { x: 0, y: 0, vx: 0, vy: 0, rot: 0, vRot: 0 }
      };
      this.keysPressed = { KeyA: false, KeyD: false, ArrowLeft: false, ArrowRight: false };

      // Флаг "игра уже завершена" - защита от повторного срабатывания
      // успеха/провала на нескольких кадрах подряд, пока окно закрывается.
      this._finished = false;

      // Звуки (плейсхолдеры под mp3, см. SOUND_PATHS выше)
      this._scratchPlaying = false;
      this.sounds = {
        scratch: new Audio(SOUND_PATHS.scratch),
        brk: new Audio(SOUND_PATHS.brk),
        success: new Audio(SOUND_PATHS.success)
      };
      this.sounds.scratch.loop = true;
      this.sounds.scratch.volume = 0.5;
      this.sounds.brk.volume = 0.7;
      this.sounds.success.volume = 0.7;

      this._rafId = null;
      this._bound = {};
    }

    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {
        id: "skyrim-lockpicking-app",
        title: "Взлом замка",
        template: `modules/${MODULE_ID}/templates/lockpick-app.hbs`,
        width: 440,
        height: "auto",
        resizable: false,
        classes: ["skyrim-lockpicking-window"]
      });
    }

    /** Удобный статический вход: открыть окно взлома */
    static open(params) {
      return new LockpickApp(params).render(true);
    }

    getData() {
      const fmt = (n) => (n >= 0 ? "+" : "") + n.toFixed(1).replace(".", ",");
      return {
        picksCount: this.lockpickCount,
        skillModDisplay: (this.skillMod >= 0 ? "+" : "") + this.skillMod,
        durabilityBonusDisplay: fmt(this.skillBonus),
        zoneBonusDisplay: fmt(this.skillBonus)
      };
    }

    async _consumeLockpick() {
      if (!this.lockpickItem) {
        this.lockpickCount = 0;
        return;
      }
      const qty = (this.lockpickItem.system?.quantity ?? 1) - 1;
      this.lockpickCount = qty;
      try {
        if (qty <= 0) {
          await this.lockpickItem.delete();
          // Возможно, у актора есть ещё одна отмычка отдельным стеком/предметом
          this.lockpickItem = SkyrimLockpicking.findLockpickItem(this.actingActor);
          if (this.lockpickItem) this.lockpickCount = this.lockpickItem.system?.quantity ?? 1;
        } else {
          await this.lockpickItem.update({ "system.quantity": qty });
        }
      } catch (err) {
        console.warn(`${MODULE_ID} | не удалось обновить отмычку`, err);
      }
    }

    /* ---------------------------- АУДИО (плейсхолдеры под mp3) ---------------------------- */

    _startScratchSound() {
      if (this._scratchPlaying) return;
      this._scratchPlaying = true;
      this.sounds.scratch.currentTime = 0;
      this.sounds.scratch.play().catch(() => {});
    }

    _updateScratchPitch(distance) {
      if (!this._scratchPlaying) return;
      // Плейсхолдер: чем дальше от нужной зоны, тем быстрее/выше звук скрежета.
      const rate = Math.min(2.5, 1 + distance / 60);
      this.sounds.scratch.playbackRate = rate;
    }

    _stopScratchSound() {
      if (!this._scratchPlaying) return;
      this._scratchPlaying = false;
      this.sounds.scratch.pause();
      this.sounds.scratch.currentTime = 0;
    }

    _playBreakSound() {
      this.sounds.brk.currentTime = 0;
      this.sounds.brk.play().catch(() => {});
    }

    _playSuccessSound() {
      this.sounds.success.currentTime = 0;
      this.sounds.success.play().catch(() => {});
    }

    /* -------------------------- ЛИСТЕНЕРЫ --------------------------- */

    activateListeners(html) {
      super.activateListeners(html);
      this.canvas = html.find(".lockpicking-canvas")[0];
      this.ctx = this.canvas.getContext("2d");
      this.picksCountEl = html.find(".picks-count")[0];

      this._bound.onMouseMove = (e) => this._onMouseMove(e);
      this._bound.onKeyDown = (e) => this._onKeyDown(e);
      this._bound.onKeyUp = (e) => this._onKeyUp(e);
      this._bound.onBlur = () => this._clearKeys();

      this.canvas.addEventListener("mousemove", this._bound.onMouseMove);
      window.addEventListener("keydown", this._bound.onKeyDown);
      window.addEventListener("keyup", this._bound.onKeyUp);
      window.addEventListener("blur", this._bound.onBlur);

      this._loop();
    }

    async close(options) {
      if (this._rafId) cancelAnimationFrame(this._rafId);
      this._stopScratchSound();
      window.removeEventListener("keydown", this._bound.onKeyDown);
      window.removeEventListener("keyup", this._bound.onKeyUp);
      window.removeEventListener("blur", this._bound.onBlur);
      return super.close(options);
    }

    _onMouseMove(e) {
      if (this.currentLockAngle > 0 || this.pickState !== "normal") return;
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      let angle = Math.atan2(-y, x) * (180 / Math.PI);
      if (angle < 0) angle = x >= 0 ? 0 : 180;
      this.currentPickAngle = angle;
    }

    _onKeyDown(e) {
      if (this.pickState === "normal" && e.code in this.keysPressed) {
        this.keysPressed[e.code] = true;
      }
    }

    _onKeyUp(e) {
      if (e.code in this.keysPressed) this.keysPressed[e.code] = false;
    }

    _clearKeys() {
      for (const key in this.keysPressed) this.keysPressed[key] = false;
      this._stopScratchSound();
    }

    /* --------------------------- ИГРОВОЙ ЦИКЛ --------------------------- */

    _loop() {
      if (this._finished) return;
      this._updateLogic();
      this._drawCanvas();
      this._rafId = requestAnimationFrame(() => this._loop());
    }

    _updateLogic() {
      if (this._finished) return;

      if (this.pickState === "breaking") {
        this.animationTimer++;
        const d = this.debris;
        d.part1.x += d.part1.vx; d.part1.y += d.part1.vy; d.part1.vy += 0.4; d.part1.rot += d.part1.vRot;
        d.part2.x += d.part2.vx; d.part2.y += d.part2.vy; d.part2.vy += 0.4; d.part2.rot += d.part2.vRot;
        if (this.currentLockAngle > 0) this.currentLockAngle -= 2;

        if (this.animationTimer > 40) {
          if (this.lockpickCount <= 0 && !this.unlimitedPicks) {
            this._onOutOfPicks();
          } else {
            this._startAppearingAnimation();
          }
        }
        return;
      }

      if (this.pickState === "appearing") {
        this.appearOffset -= 8;
        if (this.appearOffset <= 0) {
          this.appearOffset = 0;
          this.pickState = "normal";
          this._clearKeys();
        }
        return;
      }

      const isTurning = this.keysPressed.KeyD || this.keysPressed.ArrowRight ||
                         this.keysPressed.KeyA || this.keysPressed.ArrowLeft;

      if (isTurning) {
        const halfZone = this.mockLockData.totalZoneWidth / 2;
        const minSafe = this.mockLockData.targetAngle - halfZone;
        const maxSafe = this.mockLockData.targetAngle + halfZone;

        if (this.currentPickAngle >= minSafe && this.currentPickAngle <= maxSafe) {
          this._stopScratchSound();
          if (this.currentLockAngle < 90) {
            this.currentLockAngle += 1.5;
          } else {
            this.currentLockAngle = 90;
            this.pickState = "success"; // немедленно блокируем повторный вход
            this._onSuccess();
          }
        } else {
          const maxAllowedTurn = Math.max(0, 90 - Math.abs(this.currentPickAngle - this.mockLockData.targetAngle) * 3);
          if (this.currentLockAngle < maxAllowedTurn) {
            this._stopScratchSound();
            this.currentLockAngle += 1.5;
          } else {
            this.currentLockAngle = maxAllowedTurn;
            this._startScratchSound();
            const distanceToZone = Math.abs(this.currentPickAngle - this.mockLockData.targetAngle);
            this._updateScratchPitch(distanceToZone);
            this.currentPickAngle += (Math.random() - 0.5) * 5;
            this.pickDurability -= difficultyWearSpeed[this.difficulty] * this.wearMultiplier;
            if (this.pickDurability <= 0) this._triggerBreakAnimation();
          }
        }
      } else {
        this._stopScratchSound();
        if (this.currentLockAngle > 0) {
          this.currentLockAngle -= 4;
          if (this.currentLockAngle < 0) this.currentLockAngle = 0;
        }
      }
    }

    _triggerBreakAnimation() {
      this._stopScratchSound();
      this._playBreakSound();
      this.pickState = "breaking";
      this.animationTimer = 0;
      this._clearKeys();
      this._consumeLockpick().then(() => {
        if (this.picksCountEl) this.picksCountEl.innerText = this.unlimitedPicks ? "∞" : this.lockpickCount;
      });

      this.debris.part1 = { x: 50, y: 0, vx: (Math.random() - 0.4) * 2, vy: -Math.random() * 4 - 2, rot: 0, vRot: (Math.random() - 0.5) * 0.2 };
      this.debris.part2 = { x: 100, y: 0, vx: (Math.random() + 0.4) * 2, vy: -Math.random() * 3 - 4, rot: 0, vRot: (Math.random() - 0.5) * 0.3 };
    }

    _startAppearingAnimation() {
      this.pickState = "appearing";
      this.pickDurability = 100;
      this.currentLockAngle = 0;
      this.currentPickAngle = 90;
      this.mockLockData.targetAngle = Math.floor(Math.random() * 160) + 10;
      this.appearOffset = 300;
      this._clearKeys();
    }

    async _onSuccess() {
      if (this._finished) return;
      this._finished = true;
      if (this._rafId) cancelAnimationFrame(this._rafId);
      this._stopScratchSound();
      this._playSuccessSound();

      if (this.target) {
        try {
          await this.target.setFlag(MODULE_ID, "locked", false);
        } catch (err) {
          console.warn(`${MODULE_ID} | не удалось снять флаг locked`, err);
        }
      }
      this.close();
    }

    _onOutOfPicks() {
      if (this._finished) return;
      this._finished = true;
      if (this._rafId) cancelAnimationFrame(this._rafId);
      this._stopScratchSound();
      this.close();
    }

    /* ---------------------------- ОТРИСОВКА ---------------------------- */

    _drawCanvas() {
      const ctx = this.ctx;
      const canvas = this.canvas;
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let strokeColor = "#555";
      let shadowColor = "transparent";
      let shadowBlur = 0;

      if (this.pickState === "normal" && this.pickDurability < 100) {
        const stressFactor = (100 - this.pickDurability) / 100;
        const r = Math.floor(85 + 170 * stressFactor);
        const g = Math.floor(85 - 85 * stressFactor);
        const b = Math.floor(85 - 85 * stressFactor);
        strokeColor = `rgb(${r}, ${g}, ${b})`;
        shadowColor = `rgba(255, 0, 0, ${stressFactor * 0.6})`;
        shadowBlur = stressFactor * 15;
      }

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.currentLockAngle * Math.PI / 180);
      ctx.beginPath(); ctx.arc(0, 0, 90, 0, 2 * Math.PI);
      ctx.fillStyle = "#333"; ctx.fill();
      ctx.lineWidth = 6; ctx.strokeStyle = strokeColor; ctx.shadowBlur = shadowBlur; ctx.shadowColor = shadowColor; ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(0, 0, 60, 0, 2 * Math.PI);
      ctx.fillStyle = "#222"; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = "#111"; ctx.stroke();
      ctx.fillStyle = "#050505"; ctx.fillRect(-5, -25, 10, 50);
      ctx.restore();

      if (this.pickState === "breaking") {
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(-this.currentPickAngle * Math.PI / 180);
        ctx.translate(this.debris.part1.x, this.debris.part1.y); ctx.rotate(this.debris.part1.rot);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(50, 0);
        ctx.lineWidth = 4; ctx.strokeStyle = "#d1d1d1"; ctx.stroke(); ctx.restore();

        ctx.save(); ctx.translate(cx, cy); ctx.rotate(-this.currentPickAngle * Math.PI / 180);
        ctx.translate(this.debris.part2.x, this.debris.part2.y); ctx.rotate(this.debris.part2.rot);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(70, 0); ctx.lineTo(75, -8);
        ctx.lineWidth = 4; ctx.strokeStyle = "#d1d1d1"; ctx.stroke(); ctx.restore();
      } else {
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(-this.currentPickAngle * Math.PI / 180);
        ctx.translate(this.appearOffset, 0);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(140, 0);
        ctx.lineWidth = 4; ctx.strokeStyle = "#d1d1d1"; ctx.lineCap = "round";
        ctx.lineTo(145, -8); ctx.stroke(); ctx.restore();
      }
    }
  }

  SkyrimLockpicking.LockpickApp = LockpickApp;
})();
