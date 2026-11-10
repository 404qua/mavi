import { getJson } from "../lib/utils/getJson";

const data     = await getJson("data/missions.json");
const missions = data.missions;

const root   = document.getElementById("missions");
const dialog = document.getElementById("mission-dialog");

// how many cards are "above the fold" and should load eagerly
const EAGER_COUNT = 2;

// ---- helpers ----
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function primaryAlt(m) {
  const hit = m.images?.find(img => img.url === m.primaryImage);
  return hit?.alt ?? m.name;
}

// ---- cards ----
function cardHtml(m, i) {
  const loading = i < EAGER_COUNT ? "eager" : "lazy";
  return `
    <button class="mission-card" type="button" data-slug="${esc(m.slug)}">
      <div class="mission-card__media">
        <img
          src="${esc(m.primaryImage)}"
          alt="${esc(primaryAlt(m))}"
          loading="${loading}"
          decoding="async">
      </div>
      <div class="mission-card__body">
        <h3>${esc(m.name)}</h3>
        <p class="mission-card__meta">${esc(m.entity)} · ${esc(m.type)}</p>
        <span class="outcome outcome--${esc(m.outcome)}">${esc(m.outcome)}</span>
      </div>
    </button>
  `;
}

root.innerHTML = missions.map(cardHtml).join("");

// ---- detail view (built only on click) ----
root.addEventListener("click", (e) => {
  const card = e.target.closest(".mission-card");
  if (!card) return;
  const m = missions.find(x => x.slug === card.dataset.slug);
  if (m) openMission(m);
});

function openMission(m) {
  dialog.innerHTML = `
    <div class="mission-dialog__inner">
      <header class="mission-dialog__head">
        <h2>${esc(m.name)}</h2>
        <p class="mission-card__meta">
          ${esc(m.entity)} · ${esc(m.type)} · ${esc(m.era)}
        </p>
        <span class="outcome outcome--${esc(m.outcome)}">${esc(m.outcome)}</span>
        <button class="mission-dialog__close" type="button" aria-label="Close">
							<span class="material-symbols-outlined">
								close
							</span>
				</button>
      </header>

      <p class="mission-dialog__status">${esc(m.status)}</p>

      <p class="mission-dialog__source">
        <a href="${esc(m.page)}" target="_blank" rel="noopener">Source page</a>
        · ${m.source_count} sources · checked ${esc(m.facts_checked)}
      </p>

      <div class="mission-dialog__images">
        ${m.images.map(img => `
          <figure>
            <div class="img-wrap">
              <img
                src="${esc(img.url)}"
                alt="${esc(img.alt)}"
                loading="lazy"
                decoding="async">
            </div>
            <figcaption>${esc(img.alt)}</figcaption>
          </figure>
        `).join("")}
      </div>
    </div>
  `;

  dialog.querySelector(".mission-dialog__close")
        .addEventListener("click", () => dialog.close());

  dialog.showModal();
}
