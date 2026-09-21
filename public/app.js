const views = {
  login: document.querySelector("#loginView"),
  expired: document.querySelector("#expiredView"),
  gallery: document.querySelector("#galleryView"),
};

const gallery = document.querySelector("#gallery");
const emptyState = document.querySelector("#emptyState");
const loginForm = document.querySelector("#loginForm");
const loginMessage = document.querySelector("#loginMessage");
const logoutButton = document.querySelector("#logoutButton");
const lightbox = document.querySelector("#lightbox");
const lightboxImage = document.querySelector("#lightboxImage");
const caption = document.querySelector("#caption");
const closeLightbox = document.querySelector("#closeLightbox");
const prevImage = document.querySelector("#prevImage");
const nextImage = document.querySelector("#nextImage");

let images = [];
let activeIndex = 0;

function showView(name) {
  Object.entries(views).forEach(([key, node]) => {
    node.hidden = key !== name;
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...options,
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.error || "请求失败";
    throw new Error(message);
  }
  return body;
}

function renderGallery() {
  gallery.textContent = "";
  emptyState.hidden = images.length > 0;

  const fragment = document.createDocumentFragment();
  images.forEach((image, index) => {
    const section = document.createElement("section");
    section.className = "page";
    section.setAttribute("aria-label", image.name);

    const img = document.createElement("img");
    img.loading = index < 2 ? "eager" : "lazy";
    img.decoding = "async";
    img.alt = image.name;
    img.src = image.url;
    img.addEventListener("click", () => openLightbox(index));

    section.appendChild(img);
    fragment.appendChild(section);
  });

  gallery.appendChild(fragment);
}

async function loadGallery() {
  const data = await api("/api/images");
  images = data.images;
  renderGallery();
  showView("gallery");
}

async function boot() {
  try {
    const status = await api("/api/status");
    if (status.expired) {
      showView("expired");
      return;
    }
    if (status.authenticated) {
      await loadGallery();
      return;
    }
    showView("login");
  } catch {
    showView("login");
  }
}

function openLightbox(index) {
  if (!images.length) return;
  activeIndex = index;
  const image = images[activeIndex];
  lightboxImage.src = image.url;
  lightboxImage.alt = image.name;
  caption.textContent = image.name;
  lightbox.showModal();
}

function stepLightbox(offset) {
  activeIndex = (activeIndex + offset + images.length) % images.length;
  openLightbox(activeIndex);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.textContent = "";
  const password = new FormData(loginForm).get("password");

  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    loginForm.reset();
    await loadGallery();
  } catch (error) {
    loginMessage.textContent = error.message;
  }
});

logoutButton.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  images = [];
  showView("login");
});

closeLightbox.addEventListener("click", () => lightbox.close());
prevImage.addEventListener("click", () => stepLightbox(-1));
nextImage.addEventListener("click", () => stepLightbox(1));

document.addEventListener("keydown", (event) => {
  if (!lightbox.open) return;
  if (event.key === "ArrowLeft") stepLightbox(-1);
  if (event.key === "ArrowRight") stepLightbox(1);
  if (event.key === "Escape") lightbox.close();
});

boot();
