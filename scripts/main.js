/**
 * Skyrim Lockpicking - настройки, флаги и точки входа в мини-игру.
 */
(() => {
  const MODULE_ID = SkyrimLockpicking.MODULE_ID;

  /* ---------------------------- НАСТРОЙКИ (ГМ) ---------------------------- */

  Hooks.once("init", () => {
    // scope: "world" => изменять значение может только ГМ (у игроков поле
    // в окне настроек будет видно, но недоступно для редактирования).
    game.settings.register(MODULE_ID, "defaultDifficulty", {
      name: "Сложность замков по умолчанию",
      hint: "Используется для всех взламываемых предметов/токенов, у которых не выставлена индивидуальная сложность.",
      scope: "world",
      config: true,
      type: String,
      choices: {
        very_easy: "Очень просто (Прочная отмычка)",
        easy: "Просто",
        medium: "Средне",
        hard: "Сложно",
        very_hard: "Очень сложно (Хрупкая отмычка)"
      },
      default: "medium"
    });
  });

  /* ------------------------------ ФЛАГИ ------------------------------ */

  SkyrimLockpicking.isPickable = (doc) => doc?.getFlag(MODULE_ID, "pickable") === true;

  // Замок считается закрытым, пока явно не выставлено locked=false
  SkyrimLockpicking.isLocked = (doc) => doc?.getFlag(MODULE_ID, "locked") !== false;

  SkyrimLockpicking.resolveDifficulty = (doc) => {
    const override = doc?.getFlag(MODULE_ID, "difficulty");
    if (override && override !== "global" && override in SkyrimLockpicking.difficultySettings) {
      return override;
    }
    return game.settings.get(MODULE_ID, "defaultDifficulty");
  };

  /**
   * Модификатор навыка "Ловкость рук" (dnd5e: system.skills.slt) у актора.
   * Возвращает 0, если у актора нет такого навыка (например, у ГМ без
   * назначенного персонажа) - в этом случае бонус будет нулевым (дефолт).
   */
  SkyrimLockpicking.getSleightOfHandMod = (actor) => {
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
  SkyrimLockpicking.computeSkillBonus = (actor) => {
    const mod = SkyrimLockpicking.getSleightOfHandMod(actor);
    const bonus = Math.max(-0.5, Math.min(1.0, mod * 0.05));
    return { mod, bonus };
  };

  /** Кто тратит отмычки/получает успех */
  SkyrimLockpicking.resolveActingActor = (contextActor, { isOwnInventory }) => {
    if (isOwnInventory) return contextActor;
    return game.user.character ?? canvas.tokens?.controlled?.[0]?.actor ?? null;
  };

  /**
   * Ищем предмет-отмычку у актора: либо явно помеченный флагом isLockpick,
   * либо просто предмет с именем "Lockpick" (без учёта регистра/пробелов).
   * Возвращает null, если подходящего предмета с количеством > 0 нет.
   */
  SkyrimLockpicking.findLockpickItem = (actor) => {
    if (!actor) return null;
    const items = actor.items ?? [];
    for (const item of items) {
      const qty = item.system?.quantity ?? 1;
      if (qty <= 0) continue;
      const flagged = item.getFlag(MODULE_ID, "isLockpick") === true;
      const namedLockpick = (item.name ?? "").trim().toLowerCase() === "lockpick";
      if (flagged || namedLockpick) return item;
    }
    return null;
  };

  SkyrimLockpicking.launchFor = (target, actingActor, isOwnInventory) => {
    if (!SkyrimLockpicking.isPickable(target)) return;
    if (!SkyrimLockpicking.isLocked(target)) return; // уже открыт

    const actor = SkyrimLockpicking.resolveActingActor(actingActor, { isOwnInventory });
    if (!actor) {
      ui.notifications.warn("Не назначен персонаж - нечем взламывать замок.");
      return;
    }

    const lockpickItem = SkyrimLockpicking.findLockpickItem(actor);
    if (!lockpickItem) {
      ui.notifications.warn(`У ${actor.name} нет отмычек (предмет "Lockpick") - взлом невозможен.`);
      return;
    }

    const difficulty = SkyrimLockpicking.resolveDifficulty(target);
    SkyrimLockpicking.LockpickApp.open({ target, actingActor: actor, difficulty, lockpickItem });
  };

  /* --------------------- GM: ДИАЛОГ НАСТРОЙКИ ЗАМКА НА ПРЕДМЕТЕ --------------------- */

  async function openLockConfigDialog(doc) {
    const isItem = doc.documentName === "Item";
    const pickable = doc.getFlag(MODULE_ID, "pickable") === true;
    const locked = doc.getFlag(MODULE_ID, "locked") !== false;
    const difficulty = doc.getFlag(MODULE_ID, "difficulty") ?? "global";
    const isLockpickTool = isItem && doc.getFlag(MODULE_ID, "isLockpick") === true;

    const difficultyOptions = Object.entries({
      global: "— как в общих настройках модуля —",
      ...SkyrimLockpicking.difficultyLabels
    }).map(([k, v]) => `<option value="${k}" ${k === difficulty ? "selected" : ""}>${v}</option>`).join("");

    const content = `
      <form class="skyrim-lockpicking-config">
        <div class="form-group">
          <label><input type="checkbox" name="pickable" ${pickable ? "checked" : ""}/> Взламываемый (открывает мини-игру по клику)</label>
        </div>
        <div class="form-group">
          <label><input type="checkbox" name="locked" ${locked ? "checked" : ""}/> Заперт (снимается автоматически после успешного взлома)</label>
        </div>
        <div class="form-group">
          <label>Сложность:</label>
          <select name="difficulty">${difficultyOptions}</select>
        </div>
        ${isItem ? `
        <div class="form-group">
          <label><input type="checkbox" name="isLockpick" ${isLockpickTool ? "checked" : ""}/> Это расходник-отмычка (если имя предмета не "Lockpick")</label>
        </div>` : ``}
      </form>
    `;

    new Dialog({
      title: `Настройка замка: ${doc.name}`,
      content,
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: "Сохранить",
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
      label: "Замок",
      class: "skyrim-lockpicking-config-btn",
      icon: "fas fa-lock",
      onclick: () => openLockConfigDialog(sheet.object)
    });
  });

  Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
    if (!game.user.isGM) return;
    buttons.unshift({
      label: "Замок",
      class: "skyrim-lockpicking-config-btn",
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
      if (!SkyrimLockpicking.isPickable(item)) return;
      if (!SkyrimLockpicking.isLocked(item)) return; // уже открыт - обычное поведение листа

      event.stopPropagation();
      event.preventDefault();
      SkyrimLockpicking.launchFor(item, actor, true);
    };

    // capture: true - перехватываем клик ДО системных обработчиков листа персонажа
    root.addEventListener("click", handler, true);
  });

  /* --------------------- ИГРОК: ДВОЙНОЙ КЛИК ПО ТОКЕНУ-СУНДУКУ --------------------- */

  // ВАЖНО: слушаем клик напрямую на PIXI-объекте токена, а не через
  // Token.prototype._onClickLeft2. Дело в том, что Foundry вызывает
  // _onClickLeft2 только если пользователь может "управлять" токеном
  // (обычно требует прав Owner), а токены-сундуки/двери у игроков чаще
  // всего Owner не имеют. Прямой pointerdown-слушатель на токене срабатывает
  // независимо от прав владения (как и подсветка/тултип при наведении).
  Hooks.on("drawToken", (token) => {
    if (token._skyrimLockpickBound) return;
    token._skyrimLockpickBound = true;

    let lastClick = 0;
    const DBLCLICK_MS = 350;

    token.on("pointerdown", (event) => {
      const actor = token.actor;
      if (!actor) return;
      if (!SkyrimLockpicking.isPickable(actor) || !SkyrimLockpicking.isLocked(actor)) return;

      const now = Date.now();
      if (now - lastClick < DBLCLICK_MS) {
        lastClick = 0;
        event?.stopPropagation?.();
        console.debug(`${MODULE_ID} | двойной клик по токену-сундуку`, actor.name);
        SkyrimLockpicking.launchFor(actor, actor, false);
      } else {
        lastClick = now;
      }
    });
  });
})();
