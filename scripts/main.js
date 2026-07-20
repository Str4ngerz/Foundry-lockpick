/**
 * Lockpicking Minigame - настройки, флаги и точки входа в мини-игру.
 */
(() => {
  const MODULE_ID = LockpickingMinigame.MODULE_ID;
  const SOCKET = `module.${MODULE_ID}`;
  LockpickingMinigame.SOCKET = SOCKET;

  /* ------------------------ СОКЕТ: привилегированные апдейты через ГМ ------------------------ */
  // Игроки почти никогда не владеют (Owner) актором сундука/двери, поэтому
  // setFlag на успехе взлома у них падает с ошибкой прав. Вместо того чтобы
  // раздавать всем Owner на все сундуки, просим выполнить обновление любого
  // подключённого ГМ-клиента через сокет - у ГМ права есть всегда.
  Hooks.once("ready", () => {
    game.socket.on(SOCKET, async (data) => {
      if (!game.user.isGM) return; // выполняет только один (любой) ГМ-клиент
      if (data?.action === "unlock") {
        try {
          const doc = await fromUuid(data.uuid);
          if (doc) await doc.setFlag(MODULE_ID, "locked", false);
        } catch (err) {
          console.warn(`${MODULE_ID} | не удалось выполнить unlock по сокету`, err);
        }
      }
    });
  });

  /**
   * Снять флаг "заперт" с документа - напрямую, если есть права,
   * иначе через сокет силами ГМ-клиента.
   */
  LockpickingMinigame.requestUnlock = async (doc) => {
    if (doc.isOwner) {
      await doc.setFlag(MODULE_ID, "locked", false);
    } else {
      game.socket.emit(SOCKET, { action: "unlock", uuid: doc.uuid });
      console.debug(`${MODULE_ID} | нет прав Owner, запрос unlock отправлен по сокету`, doc.name);
    }
  };

  /* ---------------------------- НАСТРОЙКИ (ГМ) ---------------------------- */

  Hooks.once("init", () => {
    // scope: "client" => каждый пользователь выбирает язык МОДУЛЯ для себя,
    // независимо от общего языка интерфейса Foundry (Configure Settings -> Core).
    game.settings.register(MODULE_ID, "language", {
      name: "Module Language / Язык модуля",
      hint: "Choose the language used for this module's own text (lockpicking window, GM dialogs, messages) - independent of Foundry's interface language. / Выберите язык текстов этого модуля (окно взлома, диалоги ГМ, сообщения) - независимо от общего языка интерфейса Foundry.",
      scope: "client",
      config: true,
      type: String,
      choices: { ru: "Русский", en: "English" },
      default: "ru"
    });

    // scope: "world" => изменять значение может только ГМ (у игроков поле
    // в окне настроек будет видно, но недоступно для редактирования).
    game.settings.register(MODULE_ID, "defaultDifficulty", {
      name: LockpickingMinigame.t("settingDifficultyName"),
      hint: LockpickingMinigame.t("settingDifficultyHint"),
      scope: "world",
      config: true,
      type: String,
      choices: LockpickingMinigame.t("difficultyChoicesFull"),
      default: "medium"
    });
  });

  /* ------------------------------ ФЛАГИ ------------------------------ */

  LockpickingMinigame.isPickable = (doc) => doc?.getFlag(MODULE_ID, "pickable") === true;

  // Замок считается закрытым, пока явно не выставлено locked=false
  LockpickingMinigame.isLocked = (doc) => doc?.getFlag(MODULE_ID, "locked") !== false;

  LockpickingMinigame.resolveDifficulty = (doc) => {
    const override = doc?.getFlag(MODULE_ID, "difficulty");
    if (override && override !== "global" && override in LockpickingMinigame.difficultySettings) {
      return override;
    }
    return game.settings.get(MODULE_ID, "defaultDifficulty");
  };

  /**
   * Модификатор навыка "Ловкость рук" (dnd5e: system.skills.slt) у актора.
   * Возвращает 0, если у актора нет такого навыка (например, у ГМ без
   * назначенного персонажа) - в этом случае бонус будет нулевым (дефолт).
   */
  LockpickingMinigame.getSleightOfHandMod = (actor) => {
    if (!actor) return 0;
    const skill = actor.system?.skills?.slt;
    if (!skill) return 0;
    return skill.total ?? skill.mod ?? 0;
  };

  /**
   * Переводит модификатор навыка в игровой бонус: +0.05 (то есть +5%) за
   * каждую единицу модификатора. Ограничено разумными пределами, чтобы
   * экстремально высокая/низкая Ловкость рук не ломала баланс полностью.
   */
  LockpickingMinigame.computeSkillBonus = (actor) => {
    const mod = LockpickingMinigame.getSleightOfHandMod(actor);
    const bonus = Math.max(-0.5, Math.min(1.0, mod * 0.05));
    return { mod, bonus };
  };

  /**
   * Кто тратит отмычки/получает успех. Логика одинакова для ГМ и игрока:
   * сначала контролируемый на сцене токен (кроме самого взламываемого),
   * затем персонаж, назначенный пользователю (Configure User -> Character),
   * затем любой актор-персонаж, которым владеет пользователь (у ГМ это
   * фактически "любой персонаж в мире" - удобно для тестирования).
   */
  LockpickingMinigame.resolveActingActor = (contextActor, { isOwnInventory }) => {
    if (isOwnInventory) return contextActor;

    const controlled = canvas.tokens?.controlled?.find(t => t.actor && t.actor !== contextActor)?.actor;
    const assigned = game.user.character;
    const owned = game.actors?.find(a => a.type === "character" && a.isOwner && a !== contextActor);

    const actor = controlled ?? (assigned && assigned !== contextActor ? assigned : null) ?? owned ?? null;

    console.debug(`${MODULE_ID} | resolveActingActor`, {
      user: game.user.name, isGM: game.user.isGM,
      controlled: controlled?.name, assigned: assigned?.name, owned: owned?.name,
      resolved: actor?.name ?? null
    });

    return actor;
  };

  /**
   * Ищем предмет-отмычку у актора: либо явно помеченный флагом isLockpick,
   * либо просто предмет с именем "Lockpick" (без учёта регистра/пробелов).
   * Возвращает null, если подходящего предмета с количеством > 0 нет.
   */
  LockpickingMinigame.findLockpickItem = (actor) => {
    if (!actor) return null;
    const items = actor.items ?? [];
    const found = [];
    let match = null;
    for (const item of items) {
      const qty = item.system?.quantity ?? 1;
      const flagged = item.getFlag(MODULE_ID, "isLockpick") === true;
      const namedLockpick = (item.name ?? "").trim().toLowerCase() === "lockpick";
      found.push({ name: item.name, qty, flagged, namedLockpick });
      if (!match && qty > 0 && (flagged || namedLockpick)) match = item;
    }
    console.debug(`${MODULE_ID} | findLockpickItem`, { actor: actor.name, items: found, match: match?.name ?? null });
    return match;
  };

  LockpickingMinigame.launchFor = (target, actingActor, isOwnInventory) => {
    if (!LockpickingMinigame.isPickable(target)) {
      console.debug(`${MODULE_ID} | launchFor: цель не помечена pickable`, target?.name);
      return;
    }
    if (!LockpickingMinigame.isLocked(target)) {
      console.debug(`${MODULE_ID} | launchFor: цель уже разблокирована`, target?.name);
      return;
    }

    const actor = LockpickingMinigame.resolveActingActor(actingActor, { isOwnInventory });
    if (!actor) {
      ui.notifications.warn(LockpickingMinigame.t("noActor"));
      return;
    }

    const lockpickItem = LockpickingMinigame.findLockpickItem(actor);
    if (!lockpickItem) {
      ui.notifications.warn(LockpickingMinigame.t("noLockpick", actor.name));
      return;
    }

    const difficulty = LockpickingMinigame.resolveDifficulty(target);
    LockpickingMinigame.LockpickApp.open({ target, actingActor: actor, difficulty, lockpickItem });
  };

  /* --------------------- GM: ДИАЛОГ НАСТРОЙКИ ЗАМКА НА ПРЕДМЕТЕ --------------------- */

  async function openLockConfigDialog(doc) {
    const isItem = doc.documentName === "Item";
    const pickable = doc.getFlag(MODULE_ID, "pickable") === true;
    const locked = doc.getFlag(MODULE_ID, "locked") !== false;
    const difficulty = doc.getFlag(MODULE_ID, "difficulty") ?? "global";
    const isLockpickTool = isItem && doc.getFlag(MODULE_ID, "isLockpick") === true;

    const difficultyOptions = Object.entries({
      global: LockpickingMinigame.t("difficultyGlobalOption"),
      ...LockpickingMinigame.t("difficultyLabels")
    }).map(([k, v]) => `<option value="${k}" ${k === difficulty ? "selected" : ""}>${v}</option>`).join("");

    const content = `
      <form class="lockpicking-minigame-config">
        <div class="form-group">
          <label><input type="checkbox" name="pickable" ${pickable ? "checked" : ""}/> ${LockpickingMinigame.t("fieldPickable")}</label>
        </div>
        <div class="form-group">
          <label><input type="checkbox" name="locked" ${locked ? "checked" : ""}/> ${LockpickingMinigame.t("fieldLocked")}</label>
        </div>
        <div class="form-group">
          <label>${LockpickingMinigame.t("fieldDifficulty")}</label>
          <select name="difficulty">${difficultyOptions}</select>
        </div>
        ${isItem ? `
        <div class="form-group">
          <label><input type="checkbox" name="isLockpick" ${isLockpickTool ? "checked" : ""}/> ${LockpickingMinigame.t("fieldIsLockpick")}</label>
        </div>` : ``}
      </form>
    `;

    new Dialog({
      title: LockpickingMinigame.t("gmConfigTitle", doc.name),
      content,
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: LockpickingMinigame.t("configSaveLabel"),
          callback: async (html) => {
            const form = html[0].querySelector("form");
            const update = {
              [`flags.${MODULE_ID}.pickable`]: form.pickable.checked,
              [`flags.${MODULE_ID}.locked`]: form.locked.checked,
              [`flags.${MODULE_ID}.difficulty`]: form.difficulty.value
            };
            if (isItem) update[`flags.${MODULE_ID}.isLockpick`] = form.isLockpick.checked;
            await doc.update(update);
          }
        }
      },
      default: "save"
    }).render(true);
  }

  Hooks.on("getItemSheetHeaderButtons", (sheet, buttons) => {
    if (!game.user.isGM) return;
    buttons.unshift({
      label: LockpickingMinigame.t("headerButtonLabel"),
      class: "lockpicking-minigame-config-btn",
      icon: "fas fa-lock",
      onclick: () => openLockConfigDialog(sheet.object)
    });
  });

  Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
    if (!game.user.isGM) return;
    buttons.unshift({
      label: LockpickingMinigame.t("headerButtonLabel"),
      class: "lockpicking-minigame-config-btn",
      icon: "fas fa-lock",
      onclick: () => openLockConfigDialog(sheet.object)
    });
  });

  /* --------------------- ИГРОК: КЛИК ПО ПРЕДМЕТУ В ИНВЕНТАРЕ --------------------- */

  Hooks.on("renderActorSheet", (app, html) => {
    const actor = app.actor;
    const root = html[0] ?? html; // на случай jQuery или HTMLElement

    const handler = (event) => {
      const row = event.target.closest("[data-item-id]");
      if (!row) return;
      const item = actor.items.get(row.dataset.itemId);
      if (!item) return;
      if (!LockpickingMinigame.isPickable(item)) return;
      if (!LockpickingMinigame.isLocked(item)) return; // уже открыт - обычное поведение листа

      event.stopPropagation();
      event.preventDefault();
      LockpickingMinigame.launchFor(item, actor, true);
    };

    // capture: true - перехватываем клик ДО системных обработчиков листа персонажа
    root.addEventListener("click", handler, true);
  });

  /* --------------------- ИГРОК: ДВОЙНОЙ КЛИК ПО ТОКЕНУ-СУНДУКУ --------------------- */

  // ВАЖНО: слушаем не события самого PIXI-объекта токена (они, судя по всему,
  // у Foundry вообще не создаются/не всплывают для токенов, которыми
  // пользователь не управляет - поэтому предыдущая версия молчала в консоли
  // при клике). Вместо этого вешаем НАТИВНЫЙ DOM-обработчик прямо на
  // <canvas>-элемент (canvas.app.view) - он всегда получает клики независимо
  // от прав владения, а какой токен под курсором - определяем через
  // hoverToken, который у Foundry и так срабатывает для всех токенов
  // (иначе подсказки при наведении на чужие токены тоже не работали бы).
  let hoveredPickableToken = null;

  Hooks.on("hoverToken", (token, hovered) => {
    if (!hovered) {
      if (hoveredPickableToken === token) hoveredPickableToken = null;
      return;
    }
    const actor = token.actor;
    const eligible = actor && LockpickingMinigame.isPickable(actor) && LockpickingMinigame.isLocked(actor);
    hoveredPickableToken = eligible ? token : null;
    console.debug(`${MODULE_ID} | hoverToken`, { token: token.name, actor: actor?.name ?? null, eligible });
  });

  let boundCanvasClick = false;
  Hooks.on("canvasReady", () => {
    if (boundCanvasClick) return;
    const view = canvas.app?.view;
    if (!view) return;
    boundCanvasClick = true;

    let lastClick = 0;
    const DBLCLICK_MS = 350;

    view.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return; // только левая кнопка
      console.debug(`${MODULE_ID} | canvas pointerdown`, { hovered: hoveredPickableToken?.name ?? null });
      if (!hoveredPickableToken) return;

      const actor = hoveredPickableToken.actor;
      if (!actor || !LockpickingMinigame.isPickable(actor) || !LockpickingMinigame.isLocked(actor)) return;

      const now = Date.now();
      if (now - lastClick < DBLCLICK_MS) {
        lastClick = 0;
        console.debug(`${MODULE_ID} | двойной клик по токену-сундуку`, actor.name);
        LockpickingMinigame.launchFor(actor, actor, false);
      } else {
        lastClick = now;
      }
    });
  });
})();
