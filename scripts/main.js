class SkyrimLockpickingApp extends Application {
    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            title: "Взлом замка",
            template: "modules/skyrim-lockpicking/templates/lockpick.hbs",
            width: 480,
            height: 600,
            resizable: false
        });
    }

    // Инициализация данных
    getData() {
        return { lockpicks: 5 };
    }

    // Переносим логику поиска элементов в _render, 
    // это гарантирует, что HTML уже в DOM
    async _render(force, options) {
        await super._render(force, options);
        this._initLockpicking();
    }

    _initLockpicking() {
        this.canvas = this.element.find("#lockpicking-canvas")[0];
        if (!this.canvas) {
            console.error("SkyrimLockpicking: Canvas не найден в DOM!");
            return;
        }
        
        this.ctx = this.canvas.getContext("2d");
        this.picksCountEl = this.element.find("#picks-count")[0];
        
        // Тут ваша логика событий
        console.log("SkyrimLockpicking: Инициализация успешна");
    }

    close(options) {
        // Очистка при закрытии
        return super.close(options);
    }
}

Hooks.once("ready", () => {
    window.SkyrimLockpickingApp = SkyrimLockpickingApp;
});