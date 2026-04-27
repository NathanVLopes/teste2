const root = document.documentElement;
const canvas = document.getElementById("soundCanvas");
const ctx = canvas.getContext("2d");
const phone = document.querySelector(".spotify-phone");
const progress = document.querySelector(".scroll-progress");
const moodButtons = document.querySelectorAll(".mood-button");
const energyRange = document.getElementById("energyRange");
const energyValue = document.getElementById("energyValue");
const trackList = document.getElementById("trackList");
const playlistRows = document.getElementById("playlistRows");

const moods = {
  focus: {
    title: "Foco profundo",
    description:
      "Batidas leves, textura limpa e energia estável para entrar no trabalho sem perder o fôlego.",
    phoneTitle: "Seu flow diário",
    nowTrack: "Neon da Manhã",
    nowArtist: "Mix personalizado",
    kicker: "Mix para concentração",
    colors: ["#1ed760", "#5ee7ff", "#8cffb0"],
    tracks: [
      ["Neon da Manhã", "Lo-fi elétrico", "3:12"],
      ["Linha Clara", "Synth calmo", "2:48"],
      ["Sem Ruído", "Piano ambiente", "4:05"],
      ["Código Verde", "Beat minimal", "3:34"]
    ]
  },
  run: {
    title: "Treino aceso",
    description:
      "Graves fortes, refrões rápidos e uma sequência que empurra o corpo para frente.",
    phoneTitle: "Energia máxima",
    nowTrack: "Pulso de Rua",
    nowArtist: "Cardio hits",
    kicker: "Mix para movimento",
    colors: ["#ff6da8", "#ffd166", "#1ed760"],
    tracks: [
      ["Pulso de Rua", "Pop energético", "2:59"],
      ["Última Série", "Dance boost", "3:21"],
      ["Corrida Lunar", "Electro pop", "3:07"],
      ["Mais Um Round", "Bass house", "2:51"]
    ]
  },
  road: {
    title: "Viagem aberta",
    description:
      "Sons amplos, refrões para cantar baixo e aquela sensação de janela aberta no caminho.",
    phoneTitle: "Estrada sonora",
    nowTrack: "Cidade Distante",
    nowArtist: "Indie estrada",
    kicker: "Mix para a rota",
    colors: ["#5ee7ff", "#ffd166", "#ff6da8"],
    tracks: [
      ["Cidade Distante", "Indie solar", "3:44"],
      ["Farol Aceso", "Alt pop", "4:10"],
      ["Mapa no Banco", "Folk leve", "3:36"],
      ["Depois da Curva", "Dream rock", "4:02"]
    ]
  },
  night: {
    title: "Noite macia",
    description:
      "Vozes próximas, luz baixa e uma seleção que deixa a sala mais íntima.",
    phoneTitle: "Depois das dez",
    nowTrack: "Veludo Azul",
    nowArtist: "R&B noturno",
    kicker: "Mix para desacelerar",
    colors: ["#9b7bff", "#5ee7ff", "#ff6da8"],
    tracks: [
      ["Veludo Azul", "R&B noturno", "3:40"],
      ["Luz Baixa", "Soul eletrônico", "3:28"],
      ["Meia Voz", "Pop suave", "2:56"],
      ["Sem Pressa", "Jazz beat", "4:14"]
    ]
  }
};

let currentMood = "focus";
let pointer = { x: 0.62, y: 0.38 };
let ribbons = [];
let lastFrame = 0;

function setTheme(colors) {
  root.style.setProperty("--accent", colors[0]);
  root.style.setProperty("--accent-two", colors[1]);
  root.style.setProperty("--accent-three", colors[2]);
}

function renderTracks(mood) {
  trackList.innerHTML = mood.tracks
    .slice(0, 3)
    .map(
      ([title, artist, time], index) => `
        <div class="track-row">
          <span class="track-thumb" style="filter:hue-rotate(${index * 28}deg)"></span>
          <div>
            <strong>${title}</strong>
            <span>${artist}</span>
          </div>
          <span class="track-time">${time}</span>
        </div>
      `
    )
    .join("");

  playlistRows.innerHTML = mood.tracks
    .map(
      ([title, artist, time], index) => `
        <article class="playlist-card">
          <span class="playlist-art" style="filter:hue-rotate(${index * 34}deg)"></span>
          <div>
            <h4>${title}</h4>
            <p>${artist} · ${time}</p>
          </div>
          <div class="sound-bars" aria-hidden="true">
            <span style="--i:1"></span>
            <span style="--i:2"></span>
            <span style="--i:3"></span>
            <span style="--i:4"></span>
          </div>
        </article>
      `
    )
    .join("");
}

function applyMood(name) {
  currentMood = name;
  const mood = moods[name];

  setTheme(mood.colors);
  document.getElementById("moodTitle").textContent = mood.title;
  document.getElementById("moodDescription").textContent = mood.description;
  document.getElementById("phoneTitle").textContent = mood.phoneTitle;
  document.getElementById("nowTrack").textContent = mood.nowTrack;
  document.getElementById("nowArtist").textContent = mood.nowArtist;
  document.getElementById("boardKicker").textContent = mood.kicker;
  renderTracks(mood);

  moodButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mood === name);
  });
}

function resizeCanvas() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(canvas.offsetWidth * ratio);
  canvas.height = Math.floor(canvas.offsetHeight * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  const count = Math.max(26, Math.floor(canvas.offsetWidth / 34));
  ribbons = Array.from({ length: count }, (_, index) => ({
    x: (index / count) * canvas.offsetWidth,
    speed: 0.25 + Math.random() * 0.55,
    amp: 24 + Math.random() * 78,
    phase: Math.random() * Math.PI * 2,
    width: 1 + Math.random() * 2.4
  }));
}

function drawScene(time = 0) {
  const width = canvas.offsetWidth;
  const height = canvas.offsetHeight;
  const mood = moods[currentMood];
  const colors = mood.colors;
  const delta = Math.min(32, time - lastFrame || 16);
  lastFrame = time;

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.globalCompositeOperation = "screen";

  ribbons.forEach((line, index) => {
    line.phase += line.speed * delta * 0.001;
    const yBase = height * (0.24 + (index % 9) * 0.065);
    const pointerPull = (pointer.y - 0.5) * 52;

    ctx.beginPath();
    ctx.lineWidth = line.width;
    ctx.strokeStyle = hexToRgba(colors[index % colors.length], 0.18);

    for (let x = -40; x <= width + 40; x += 22) {
      const wave =
        Math.sin(x * 0.008 + line.phase + index * 0.35) * line.amp +
        Math.sin(x * 0.018 + time * 0.001) * 12;
      const magnetic =
        Math.sin((x / width - pointer.x) * Math.PI) * pointerPull;
      const y = yBase + wave * 0.28 + magnetic;

      if (x === -40) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();
  });

  const bars = 36;
  const baseY = height * 0.82;
  for (let index = 0; index < bars; index += 1) {
    const x = (index / (bars - 1)) * width;
    const pulse =
      18 +
      Math.sin(time * 0.004 + index * 0.55) *
        (18 + Number(energyRange.value) * 2.6);
    ctx.fillStyle = hexToRgba(colors[index % colors.length], 0.28);
    ctx.fillRect(x, baseY - pulse, 3, pulse);
  }

  ctx.restore();
  requestAnimationFrame(drawScene);
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const bigint = parseInt(value, 16);
  const red = (bigint >> 16) & 255;
  const green = (bigint >> 8) & 255;
  const blue = bigint & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function updateScroll() {
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const available =
    document.documentElement.scrollHeight - document.documentElement.clientHeight;
  const percent = available > 0 ? (scrollTop / available) * 100 : 0;
  progress.style.width = `${percent}%`;
}

function updateEnergy() {
  const value = energyRange.value;
  root.style.setProperty("--energy", value);
  energyValue.textContent = value;
}

moodButtons.forEach((button) => {
  button.addEventListener("click", () => applyMood(button.dataset.mood));
});

energyRange.addEventListener("input", updateEnergy);

window.addEventListener("pointermove", (event) => {
  pointer = {
    x: event.clientX / window.innerWidth,
    y: event.clientY / window.innerHeight
  };

  if (phone) {
    const rotateY = (pointer.x - 0.5) * 18;
    const rotateX = (0.5 - pointer.y) * 10;
    phone.style.setProperty("--ry", `${rotateY}deg`);
    phone.style.setProperty("--rx", `${rotateX}deg`);
  }
});

document.querySelectorAll(".magnetic").forEach((element) => {
  element.addEventListener("pointermove", (event) => {
    const rect = element.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    element.style.transform = `translate(${x * 0.08}px, ${y * 0.14}px)`;
  });

  element.addEventListener("pointerleave", () => {
    element.style.transform = "";
  });
});

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("in-view");
      }
    });
  },
  { threshold: 0.16 }
);

document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));

window.addEventListener("resize", resizeCanvas);
window.addEventListener("scroll", updateScroll, { passive: true });

applyMood(currentMood);
updateEnergy();
resizeCanvas();
updateScroll();
requestAnimationFrame(drawScene);
