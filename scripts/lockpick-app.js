/**
 * Lockpicking Minigame - core minigame Application
 * Порт логики из авторского HTML-прототипа в FoundryVTT Application.
 */
window.LockpickingMinigame = window.LockpickingMinigame || {};

(() => {
  const MODULE_ID = "lockpicking-minigame";
  LockpickingMinigame.MODULE_ID = MODULE_ID;

  // Настройки сложности - идентичны прототипу
  const difficultySettings = { very_easy: 60, easy: 45, medium: 30, hard: 15, very_hard: 5 };
  const difficultyWearSpeed = { very_easy: 0.8, easy: 1.5, medium: 2.5, hard: 4.5, very_hard: 8.0 };
  LockpickingMinigame.difficultySettings = difficultySettings;
  LockpickingMinigame.difficultyWearSpeed = difficultyWearSpeed;

  // Пути к звукам-плейсхолдерам. Просто положите свои mp3 в modules/lockpicking-minigame/sounds/
  // с этими именами - код ничего больше менять не потребует.
  const SOUND_PATHS = {
    scratch: `modules/${MODULE_ID}/sounds/scratch.mp3`,
    brk: `modules/${MODULE_ID}/sounds/break.mp3`,
    success: `modules/${MODULE_ID}/sounds/success.mp3`,
    probe: `modules/${MODULE_ID}/sounds/probe.mp3`, // движение отмычки туда-сюда без поворота замка
    turn: `modules/${MODULE_ID}/sounds/turn.mp3`    // поворот замка, пока отмычка держит правильное положение
  };

  // Пути к текстурам-плейсхолдерам. Замените файлы в modules/lockpicking-minigame/textures/
  // на свою графику - код ничего менять не потребует, если сохранить имена файлов.
  const TEXTURE_PATHS = {
    background: `modules/${MODULE_ID}/textures/background.png`, // статичный фон, не вращается
    lock: `modules/${MODULE_ID}/textures/lock.png`,               // сам замок - ЭТА текстура проворачивается
    pick: `modules/${MODULE_ID}/textures/pick.png`                // отмычка - точка поворота у левого края спрайта
  };

  /**
   * Снятие флага "locked" с цели. Игрок обычно НЕ владеет актором
   * сундука/двери (особенно если это ActorDelta от unlinked-токена), поэтому
   * прямой setFlag() у него падает с ошибкой прав. Если апдейтить самому
   * можно (ГМ или Owner) - делаем это напрямую; иначе просим сделать это
   * любой активный ГМ-клиент через socket.
   */
  const SOCKET_CHANNEL = `module.${MODULE_ID}`;
  const SOCKET_RESPONSE_CHANNEL = `module.${MODULE_ID}.response`;

  LockpickingMinigame.requestUnlock = (target) => {
    if (!target) return Promise.resolve(false);
    if (game.user.isGM || target.isOwner) {
      return target.setFlag(MODULE_ID, "locked", false).then(() => true).catch((err) => {
        console.warn(`${MODULE_ID} | прямое снятие locked не удалось`, err);
        return false;
      });
    }
    return new Promise((resolve) => {
      const requestId = foundry.utils.randomID();
      let settled = false;
      const onResponse = (payload) => {
        if (payload?.requestId !== requestId) return;
        settled = true;
        game.socket.off(SOCKET_RESPONSE_CHANNEL, onResponse);
        resolve(payload.ok === true);
      };
      game.socket.on(SOCKET_RESPONSE_CHANNEL, onResponse);
      setTimeout(() => {
        if (settled) return;
        game.socket.off(SOCKET_RESPONSE_CHANNEL, onResponse);
        resolve(false);
      }, 4000);
      game.socket.emit(SOCKET_CHANNEL, { action: "unlock", uuid: target.uuid, requester: game.user.id, requestId });
    });
  };

  Hooks.once("ready", () => {
    game.socket.on(SOCKET_CHANNEL, async (payload) => {
      if (!game.user.isGM) return;
      if (payload?.action !== "unlock") return;
      let ok = false;
      try {
        const doc = await fromUuid(payload.uuid);
        if (doc) {
          await doc.setFlag(MODULE_ID, "locked", false);
          ok = true;
        }
        console.debug(`${MODULE_ID} | socket: снял locked по запросу игрока`, payload.uuid, "ok:", ok);
      } catch (err) {
        console.warn(`${MODULE_ID} | socket unlock failed`, err);
      }
      game.socket.emit(SOCKET_RESPONSE_CHANNEL, { requestId: payload.requestId, ok });
    });
  });

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
      const skillInfo = LockpickingMinigame.computeSkillBonus(this.actingActor);
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
      this._turnPlaying = false;
      this._lastProbeSoundTime = 0;
      this.sounds = {
        scratch: new Audio(SOUND_PATHS.scratch),
        brk: new Audio(SOUND_PATHS.brk),
        success: new Audio(SOUND_PATHS.success),
        probe: new Audio(SOUND_PATHS.probe),
        turn: new Audio(SOUND_PATHS.turn)
      };
      this.sounds.scratch.loop = true;
      this.sounds.scratch.volume = 0.5;
      this.sounds.brk.volume = 0.7;
      this.sounds.success.volume = 0.7;
      this.sounds.probe.volume = 0.3;
      this.sounds.turn.loop = true;
      this.sounds.turn.volume = 0.4;

      // Спрайты - фон статичен, замок вращается вместе с currentLockAngle,
      // отмычка вращается вместе с currentPickAngle (см. _loadImages()).
      this.images = { background: null, lock: null, pick: null };
      this._imagesReady = false;

      this._rafId = null;
      this._bound = {};
    }

    _loadImages() {
      const load = (src) => new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => { console.warn(`${MODULE_ID} | не удалось загрузить текстуру`, src); resolve(null); };
        img.src = src;
      });

      // Многие текстуры (особенно экспортированные из 3D-рендера) содержат
      // огромные прозрачные поля вокруг самого объекта - если использовать
      // весь холст файла как есть, реальный рисунок оказывается крошечным
      // после масштабирования. Поэтому вычисляем bounding box непрозрачных
      // пикселей и дальше везде используем именно его как "содержимое".
      const trim = (img) => {
        if (!img) return null;
        try {
          const off = document.createElement("canvas");
          off.width = img.naturalWidth;
          off.height = img.naturalHeight;
          const octx = off.getContext("2d", { willReadFrequently: true });
          octx.drawImage(img, 0, 0);

          const w = off.width, h = off.height;
          const step = Math.max(1, Math.floor(Math.max(w, h) / 512)); // выборка для скорости на больших текстурах
          const data = octx.getImageData(0, 0, w, h).data;

          let minX = w, minY = h, maxX = -1, maxY = -1;
          for (let y = 0; y < h; y += step) {
            for (let x = 0; x < w; x += step) {
              if (data[(y * w + x) * 4 + 3] > 8) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }

          const box = (maxX < minX || maxY < minY)
            ? { x: 0, y: 0, w, h }
            : { x: Math.max(0, minX - step), y: Math.max(0, minY - step),
                w: Math.min(w, maxX - minX + 1 + step * 2), h: Math.min(h, maxY - minY + 1 + step * 2) };

          return { img, box };
        } catch (err) {
          console.warn(`${MODULE_ID} | не удалось определить границы содержимого текстуры`, err);
          return { img, box: { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight } };
        }
      };

      return Promise.all([
        load(TEXTURE_PATHS.background),
        load(TEXTURE_PATHS.lock),
        load(TEXTURE_PATHS.pick)
      ]).then(([background, lock, pick]) => {
        this.images = { background: trim(background), lock: trim(lock), pick: trim(pick) };
        this._imagesReady = true;
      });
    }

    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {
        id: "lockpicking-minigame-app",
        title: LockpickingMinigame.t("windowTitle"),
        template: `modules/${MODULE_ID}/templates/lockpick-app.hbs`,
        width: 460,
        height: "auto",
        resizable: false,
        classes: ["lockpicking-minigame-window"]
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
        picksLabel: LockpickingMinigame.t("picksLabel"),
        controlsHint: LockpickingMinigame.t("controlsHint"),
        skillLine: LockpickingMinigame.t(
          "skillLine",
          (this.skillMod >= 0 ? "+" : "") + this.skillMod,
          fmt(this.skillBonus),
          fmt(this.skillBonus)
        )
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
          this.lockpickItem = LockpickingMinigame.findLockpickItem(this.actingActor);
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

    _startTurnSound() {
      if (this._turnPlaying) return;
      this._turnPlaying = true;
      this.sounds.turn.currentTime = 0;
      this.sounds.turn.play().catch(() => {});
    }

    _stopTurnSound() {
      if (!this._turnPlaying) return;
      this._turnPlaying = false;
      this.sounds.turn.pause();
      this.sounds.turn.currentTime = 0;
    }

    /** Короткий звук "нащупывания" при движении мыши без поворота замка - throttled */
    _playProbeSound() {
      const now = Date.now();
      if (now - this._lastProbeSoundTime < 150) return;
      this._lastProbeSoundTime = now;
      this.sounds.probe.currentTime = 0;
      this.sounds.probe.play().catch(() => {});
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

      // Загружаем текстуры асинхронно, но не блокируем открытие окна ими -
      // цикл отрисовки сам подождёт готовности (см. _drawCanvas).
      this._loadImages();

      this._loop();
    }

    async close(options) {
      if (this._rafId) cancelAnimationFrame(this._rafId);
      this._stopScratchSound();
      this._stopTurnSound();
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
      if (Math.abs(angle - this.currentPickAngle) > 0.5) this._playProbeSound();
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
      this._stopTurnSound();
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
          this._startTurnSound();
          if (this.currentLockAngle < 90) {
            this.currentLockAngle += 1.5;
          } else {
            this.currentLockAngle = 90;
            this.pickState = "success"; // немедленно блокируем повторный вход
            this._stopTurnSound();
            this._onSuccess();
          }
        } else {
          const maxAllowedTurn = Math.max(0, 90 - Math.abs(this.currentPickAngle - this.mockLockData.targetAngle) * 3);
          if (this.currentLockAngle < maxAllowedTurn) {
            this._stopScratchSound();
            this._stopTurnSound();
            this.currentLockAngle += 1.5;
          } else {
            this.currentLockAngle = maxAllowedTurn;
            this._stopTurnSound();
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
        this._stopTurnSound();
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
      this._stopTurnSound();
      this._playSuccessSound();

      const who = this.actingActor?.name ?? game.user.name;
      const what = this.target?.name ?? LockpickingMinigame.t("windowTitle");
      ChatMessage.create({
        content: LockpickingMinigame.t("successChat", who, what),
        speaker: ChatMessage.getSpeaker({ actor: this.actingActor })
      });

      if (this.target) {
        try {
          const ok = await LockpickingMinigame.requestUnlock(this.target);
          if (ok === false) {
            console.warn(`${MODULE_ID} | не удалось снять флаг locked - похоже, ни один ГМ-клиент не в сети`);
          }
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
      this._stopTurnSound();
      this.close();
    }

    /* ---------------------------- ОТРИСОВКА ---------------------------- */

    _drawCanvas() {
      const ctx = this.ctx;
      const canvas = this.canvas;
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (!this._imagesReady) return; // подождём один-два кадра, пока грузятся текстуры

      const { background, lock, pick } = this.images;

      // Единый масштаб, посчитанный от фона: фон и замок родом из одной
      // сцены/рендера в одинаковом холсте (4096x4096), поэтому если
      // применить К ОБОИМ ОДИН И ТОТ ЖЕ коэффициент масштабирования (а не
      // считать для замка отдельный "contain" в свой личный target), их
      // изначальные пропорции друг к другу сохранятся без зазора - именно
      // так, как они и задуманы художником.
      let bgScale = 400 / 400;
      if (background) {
        const { box } = background;
        bgScale = 400 / Math.max(box.w, box.h);
      }

      if (background) {
        const { img, box } = background;
        const dw = box.w * bgScale, dh = box.h * bgScale;
        ctx.drawImage(img, box.x, box.y, box.w, box.h, cx - dw / 2, cy - dh / 2, dw, dh);
      }

      // Замок - ЭТА текстура вращается вместе с currentLockAngle.
      // Масштабируется ТЕМ ЖЕ коэффициентом, что и фон (см. выше) - никакого
      // отдельного "подгона под 200px", поэтому зазора с фоном не будет.
      let lockDw = 0, lockDh = 0;
      if (lock) {
        const { img, box } = lock;
        lockDw = box.w * bgScale;
        lockDh = box.h * bgScale;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(this.currentLockAngle * Math.PI / 180);
        ctx.drawImage(img, box.x, box.y, box.w, box.h, -lockDw / 2, -lockDh / 2, lockDw, lockDh);
        ctx.restore();
      }

      // Индикатор напряжения - просто полупрозрачный красный круг ПОВЕРХ
      // замка (не тень под спрайтом, как раньше), не вращается вместе с
      // замком - это просто накладной индикатор состояния.
      if (this.pickState === "normal" && this.pickDurability < 100) {
        const stressFactor = (100 - this.pickDurability) / 100;
        const radius = (lockDw ? Math.max(lockDw, lockDh) : 200) / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, 2 * Math.PI);
        ctx.fillStyle = `rgba(255, 0, 0, ${stressFactor * 0.35})`;
        ctx.fill();
        ctx.restore();
      }

      // Отмычка / обломки отмычки.
      // Ширина (видимая "длина/охват" отмычки) фиксирована - это влияет на
      // игровую механику вращения, поэтому держим её постоянной. Высота же
      // считается от реальных пропорций СОДЕРЖИМОГО файла (box), а не всего
      // холста. Обрезка на обломки - в долях от box.w/h, так что любые поля
      // вокруг рисунка в исходнике больше не проблема.
      //
      // Точка поворота отмычки сдвинута немного ВВЕРХ (pivotYOffset), чтобы
      // она визуально попадала в круглую/центральную часть замка, а не в
      // геометрический центр текстуры. И, что важно, вся эта точка поворота
      // вложена ВНУТРЬ поворота замка (ctx.rotate(currentLockAngle) идёт
      // первым) - поэтому отмычка физически "едет" вместе с замком при его
      // вращении, а не остаётся неподвижной относительно экрана.
      if (pick) {
        const { img, box } = pick;
        const displayW = 180;
        const splitFrac = 1 / 3; // доля по ширине, где отмычка "переламывается" на 2 обломка
        const scale = displayW / box.w;
        const displayH = box.h * scale;
        const pivotYOffset = -(lockDh ? lockDh * 0.18 : 15); // сдвиг вверх, в круглую часть замка

        if (this.pickState === "breaking") {
          const sw1 = box.w * splitFrac, dw1 = displayW * splitFrac;
          const sw2 = box.w - sw1, dw2 = displayW - dw1;

          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(this.currentLockAngle * Math.PI / 180);
          ctx.translate(0, pivotYOffset);
          ctx.rotate(-this.currentPickAngle * Math.PI / 180);
          ctx.translate(this.debris.part1.x, this.debris.part1.y); ctx.rotate(this.debris.part1.rot);
          ctx.drawImage(img, box.x, box.y, sw1, box.h, 0, -displayH / 2, dw1, displayH);
          ctx.restore();

          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(this.currentLockAngle * Math.PI / 180);
          ctx.translate(0, pivotYOffset);
          ctx.rotate(-this.currentPickAngle * Math.PI / 180);
          ctx.translate(this.debris.part2.x, this.debris.part2.y); ctx.rotate(this.debris.part2.rot);
          ctx.drawImage(img, box.x + sw1, box.y, sw2, box.h, 0, -displayH / 2, dw2, displayH);
          ctx.restore();
        } else {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(this.currentLockAngle * Math.PI / 180);
          ctx.translate(0, pivotYOffset);
          ctx.rotate(-this.currentPickAngle * Math.PI / 180);
          ctx.translate(this.appearOffset, 0);
          ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, -displayH / 2, displayW, displayH);
          ctx.restore();
        }
      }
    }
  }

  LockpickingMinigame.LockpickApp = LockpickApp;
})();
