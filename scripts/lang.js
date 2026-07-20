/**
 * Lockpicking Minigame - локализация модуля.
 * Отдельная от языка интерфейса Foundry настройка - каждый пользователь может
 * выбрать английский или русский текст модуля независимо от общего языка core.
 */
window.LockpickingMinigame = window.LockpickingMinigame || {};

(() => {
  const MODULE_ID = "lockpicking-minigame";

  const STRINGS = {
    ru: {
      windowTitle: "Взлом замка",
      picksLabel: "Осталось отмычек:",
      controlsHint: "Управление: <strong>Движение мыши</strong> — угол отмычки | Зажатие <strong>A / D</strong> — поворот замка",
      skillLine: (mod, durBonus, zoneBonus) =>
        `Ловкость рук: ${mod} (прочность отмычки ${durBonus}, размер области ${zoneBonus})`,
      successChat: (who, what) => `<b>${who}</b> вскрывает замок: <b>${what}</b>.`,
      noActor: "Не назначен персонаж - нечем взламывать замок.",
      noLockpick: (name) => `У ${name} нет отмычек (предмет "Lockpick") - взлом невозможен.`,
      gmConfigTitle: (name) => `Настройка замка: ${name}`,
      fieldPickable: "Взламываемый (открывает мини-игру по клику)",
      fieldLocked: "Заперт (снимается автоматически после успешного взлома)",
      fieldDifficulty: "Сложность:",
      fieldIsLockpick: "Это расходник-отмычка (если имя предмета не \"Lockpick\")",
      difficultyGlobalOption: "— как в общих настройках модуля —",
      difficultyLabels: {
        very_easy: "Очень просто",
        easy: "Просто",
        medium: "Средне",
        hard: "Сложно",
        very_hard: "Очень сложно"
      },
      difficultyChoicesFull: {
        very_easy: "Очень просто (Прочная отмычка)",
        easy: "Просто",
        medium: "Средне",
        hard: "Сложно",
        very_hard: "Очень сложно (Хрупкая отмычка)"
      },
      settingLanguageName: "Язык модуля",
      settingLanguageHint: "Язык текстов этого модуля (окно взлома, диалоги ГМ, сообщения) - независимо от общего языка интерфейса Foundry.",
      settingDifficultyName: "Сложность замков по умолчанию",
      settingDifficultyHint: "Используется для всех взламываемых предметов/токенов, у которых не выставлена индивидуальная сложность.",
      headerButtonLabel: "Замок",
      configSaveLabel: "Сохранить"
    },
    en: {
      windowTitle: "Lockpicking",
      picksLabel: "Lockpicks remaining:",
      controlsHint: "Controls: <strong>Mouse movement</strong> — pick angle | Hold <strong>A / D</strong> — turn the lock",
      skillLine: (mod, durBonus, zoneBonus) =>
        `Sleight of Hand: ${mod} (pick durability ${durBonus}, safe zone size ${zoneBonus})`,
      successChat: (who, what) => `<b>${who}</b> picks the lock: <b>${what}</b>.`,
      noActor: "No character assigned - nothing to pick the lock with.",
      noLockpick: (name) => `${name} has no lockpicks (item "Lockpick") - cannot attempt the lock.`,
      gmConfigTitle: (name) => `Lock settings: ${name}`,
      fieldPickable: "Pickable (opens the minigame on click)",
      fieldLocked: "Locked (cleared automatically after a successful pick)",
      fieldDifficulty: "Difficulty:",
      fieldIsLockpick: "This is a lockpick consumable (if the item isn't named \"Lockpick\")",
      difficultyGlobalOption: "— use the module's default setting —",
      difficultyLabels: {
        very_easy: "Very easy",
        easy: "Easy",
        medium: "Medium",
        hard: "Hard",
        very_hard: "Very hard"
      },
      difficultyChoicesFull: {
        very_easy: "Very easy (Sturdy lockpick)",
        easy: "Easy",
        medium: "Medium",
        hard: "Hard",
        very_hard: "Very hard (Fragile lockpick)"
      },
      settingLanguageName: "Module language",
      settingLanguageHint: "Language used for this module's own text (lockpicking window, GM dialogs, messages) - independent of Foundry's overall interface language.",
      settingDifficultyName: "Default lock difficulty",
      settingDifficultyHint: "Used for every pickable item/token that doesn't have its own difficulty override.",
      headerButtonLabel: "Lock",
      configSaveLabel: "Save"
    }
  };

  LockpickingMinigame.STRINGS = STRINGS;

  /** Текущий выбранный язык модуля ("ru" по умолчанию, до регистрации настройки) */
  LockpickingMinigame.currentLang = () => {
    try {
      return game.settings.get(MODULE_ID, "language");
    } catch (err) {
      return "ru"; // настройка ещё не зарегистрирована (слишком рано вызвано)
    }
  };

  /** t("key") - вернуть строку на текущем языке модуля; поддерживает функции-шаблоны через t("key", ...args) */
  LockpickingMinigame.t = (key, ...args) => {
    const lang = LockpickingMinigame.currentLang();
    const table = STRINGS[lang] ?? STRINGS.ru;
    const value = table[key] ?? STRINGS.ru[key] ?? key;
    return typeof value === "function" ? value(...args) : value;
  };
})();
