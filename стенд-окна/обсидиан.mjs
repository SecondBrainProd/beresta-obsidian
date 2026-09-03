/*
 * Подставной `obsidian` для СТЕНДА ВИДА — и ничего сверх того.
 *
 * **Это не Obsidian и не двойник Obsidian.** Здесь нет ни одной строки
 * поведения: только те помощники разметки, которыми пользуется окно
 * (`createEl`, `createDiv`, `empty`, `hide`), и пустая коробка `Modal`, чтобы
 * `class X extends Modal` собрался. Ни `vault`, ни `app`, ни событий.
 *
 * **Что стенд доказывает и чего не доказывает.** Доказывает вёрстку: налезают
 * ли кнопки, влезает ли текст, видно ли нижнюю полосу, стоит ли пояснение при
 * своей строке. Не доказывает ничего о поведении настоящего приложения — для
 * этого прогон глазами в самом Obsidian.
 */

function apply(el, options) {
  if (options === undefined) return el;
  if (typeof options === "string") { el.className = options; return el; }
  if (options.cls !== undefined) el.className = Array.isArray(options.cls) ? options.cls.join(" ") : options.cls;
  if (options.text !== undefined) el.textContent = options.text;
  if (options.attr !== undefined) for (const [k, v] of Object.entries(options.attr)) el.setAttribute(k, String(v));
  return el;
}

export function installDomHelpers(window) {
  const proto = window.HTMLElement.prototype;
  proto.createEl = function (tag, options) {
    const el = apply(this.ownerDocument.createElement(tag), options);
    this.appendChild(el);
    return el;
  };
  proto.createDiv = function (options) { return this.createEl("div", options); };
  proto.createSpan = function (options) { return this.createEl("span", options); };
  proto.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
  proto.setText = function (text) { this.textContent = text; };
  proto.addClass = function (...cls) { this.classList.add(...cls); };
  proto.removeClass = function (...cls) { this.classList.remove(...cls); };
  proto.toggleClass = function (cls, on) { this.classList.toggle(cls, on); };
  proto.hide = function () { this.style.display = "none"; };
  proto.show = function () { this.style.display = ""; };
}

export class Modal {
  constructor() {
    const doc = globalThis.document;
    const container = doc.createElement("div");
    container.className = "modal-container mod-dim";
    const bg = doc.createElement("div");
    bg.className = "modal-bg";
    const modal = doc.createElement("div");
    modal.className = "modal";
    const close = doc.createElement("div");
    close.className = "modal-close-button";
    const title = doc.createElement("div");
    title.className = "modal-title";
    const content = doc.createElement("div");
    content.className = "modal-content";
    modal.append(close, title, content);
    container.append(bg, modal);
    this.containerEl = container;
    this.modalEl = modal;
    this.titleEl = title;
    this.contentEl = content;
  }
  open() {
    globalThis.document.body.appendChild(this.containerEl);
    this.onOpen();
  }
  close() {
    this.onClose();
    this.containerEl.remove();
  }
  onOpen() {}
  onClose() {}
}

export class Plugin {}
export class ItemView {}
export class PluginSettingTab {}
export class Setting {}
export class Notice {}
export class MarkdownView {}
export class TFile {}
export class TFolder {}
export function normalizePath(path) { return path; }
