/** Date-only calendar controls for the Energy chart helpers. */
export function dateString(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function datePresets(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (offset) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  const year = today.getFullYear();
  const month = today.getMonth();
  return {
    Today: [day(0), day(0)],
    Yesterday: [day(-1), day(-1)],
    "This week": [day(-today.getDay()), day(6 - today.getDay())],
    "This month": [new Date(year, month, 1), new Date(year, month + 1, 0)],
    "This year": [new Date(year, 0, 1), new Date(year, 11, 31)],
    "Last 7 days": [day(-6), day(0)],
    "Last 30 days": [day(-29), day(0)],
  };
}

export function shiftRange(start, end, direction) {
  const year = start.getFullYear();
  const month = start.getMonth();
  const fullMonth =
    start.getDate() === 1 &&
    year === end.getFullYear() &&
    month === end.getMonth() &&
    end.getDate() === new Date(year, month + 1, 0).getDate();
  if (fullMonth) {
    return [
      new Date(year, month + direction, 1),
      new Date(year, month + direction + 1, 0),
    ];
  }
  if (
    month === 0 && start.getDate() === 1 &&
    end.getFullYear() === year && end.getMonth() === 11 && end.getDate() === 31
  ) {
    return [new Date(year + direction, 0, 1), new Date(year + direction, 11, 31)];
  }
  // UTC is used only to count calendar dates across daylight-saving changes.
  const days = Math.round((
    Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) -
    Date.UTC(year, month, start.getDate())
  ) / 86400000) + 1;
  return [start, end].map((date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate() + direction * days)
  );
}

class EnergyDateRangeCard extends HTMLElement {
  setConfig(config) {
    if (!config.start_entity || !config.end_entity) {
      throw new Error("Set start_entity and end_entity to the date helpers.");
    }
    this._config = config;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._ensurePicker();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  getCardSize() { return 1; }

  async _ensurePicker() {
    if (this._loading || this._picker) return;
    this._loading = true;
    this.shadowRoot.innerHTML = "<ha-card style='padding:16px'>Loading calendar…</ha-card>";
    try {
      // Loading the built-in Energy card registers its native calendar component.
      const helpers = await window.loadCardHelpers();
      await helpers.createCardElement({ type: "energy-date-selection" });
      if (!customElements.get("ha-date-range-picker")) {
        throw new Error("This Home Assistant version does not expose its calendar.");
      }
      this.shadowRoot.innerHTML = `
        <style>
          :host { display:block; }
          ha-card { padding:12px; }
          .row { display:flex; align-items:center; gap:4px; }
          button {
            background:transparent; color:var(--primary-text-color); border:0;
            font:inherit; min-height:44px; cursor:pointer; border-radius:8px;
          }
          button:hover { background:var(--secondary-background-color); }
          button:focus-visible { outline:2px solid var(--primary-color); }
          button:disabled { opacity:.5; cursor:default; }
          .arrow { font-size:28px; width:44px; flex:none; }
          .range { flex:1; text-align:left; }
          ha-date-range-picker { flex:none; }
          .error { color:var(--error-color); font-size:14px; }
        </style>
        <ha-card>
          <div class="row">
            <button class="arrow previous" aria-label="Previous period">‹</button>
            <ha-date-range-picker></ha-date-range-picker>
            <button class="range" aria-label="Select date range"></button>
            <button class="arrow next" aria-label="Next period">›</button>
          </div>
          <div class="error" role="status"></div>
        </ha-card>`;
      this._picker = this.shadowRoot.querySelector("ha-date-range-picker");
      this._picker.minimal = true;
      this._picker.timePicker = false;
      this._picker.extendedPresets = false;
      this._picker.backdrop = true;
      this._picker.popoverPlacement = "top-start";
      this._picker.addEventListener("value-changed", (event) => {
        event.stopPropagation();
        const value = event.detail?.value;
        if (value?.startDate && value?.endDate) {
          this._save(new Date(value.startDate), new Date(value.endDate));
        }
      });
      this.shadowRoot.querySelector(".range").onclick = () => {
        this._picker.ranges = datePresets();
        this._picker.open();
      };
      this.shadowRoot.querySelector(".previous").onclick = () => this._shift(-1);
      this.shadowRoot.querySelector(".next").onclick = () => this._shift(1);
      this._update();
    } catch (error) {
      this.shadowRoot.textContent = `Calendar could not load: ${error.message}`;
    } finally {
      this._loading = false;
    }
  }

  _update() {
    if (!this._picker || !this._hass || !this._config) return;
    const start = new Date(this._hass.states[this._config.start_entity]?.state + "T00:00:00");
    const end = new Date(this._hass.states[this._config.end_entity]?.state + "T00:00:00");
    const valid = Number.isFinite(+start) && Number.isFinite(+end) && end >= start;
    this._picker.hass = this._hass;
    this._picker.locale = this._hass.locale;
    this._picker.startDate = start;
    this._picker.endDate = end;
    this._picker.ranges = datePresets();
    this._picker.disabled = !valid || this._saving;
    const label = this.shadowRoot.querySelector(".range");
    label.textContent = valid
      ? [start, end].map(d => d.toLocaleDateString(this._hass.locale?.language, {
        month: "short", day: "numeric", year: "numeric",
      })).join(" – ")
      : "Select a valid date range";
    this.shadowRoot.querySelectorAll("button").forEach(button => {
      button.disabled = !valid || this._saving;
    });
  }

  _shift(direction) {
    const { startDate, endDate } = this._picker;
    this._save(...shiftRange(startDate, endDate, direction));
  }

  async _save(start, end) {
    if (this._saving || !Number.isFinite(+start) || !Number.isFinite(+end) || end < start) return;
    this._saving = true;
    const status = this.shadowRoot.querySelector(".error");
    status.textContent = "";
    this._update();
    try {
      await Promise.all([
        this._hass.callService("input_datetime", "set_datetime", {
          entity_id: this._config.start_entity, date: dateString(start),
        }),
        this._hass.callService("input_datetime", "set_datetime", {
          entity_id: this._config.end_entity, date: dateString(end),
        }),
      ]);
    } catch {
      status.textContent = "Could not save the date range. Please try again.";
    } finally {
      this._saving = false;
      this._update();
    }
  }
}

if (!customElements.get("energy-date-range-card")) {
  customElements.define("energy-date-range-card", EnergyDateRangeCard);
}
window.customCards = window.customCards || [];
window.customCards.push({
  type: "energy-date-range-card",
  name: "Energy date range",
  description: "Native date-only calendar linked to chart date helpers.",
});
