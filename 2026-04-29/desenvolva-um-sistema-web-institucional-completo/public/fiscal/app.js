const $ = (selector) => document.querySelector(selector);

let detector = null;
let stream = null;
let scanning = false;
let pendingToken = new URLSearchParams(window.location.search).get('token') || '';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function api(path, options = {}) {
  const response = await fetch(`/api/fiscal${path}`, {
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Falha na consulta.');
  }
  return data;
}

function message(text, ok = false) {
  $('#manualMessage').textContent = text || '';
  $('#manualMessage').classList.toggle('ok', Boolean(ok));
}

function openApp(user) {
  $('#loginPage').classList.add('hidden');
  $('#fiscalShell').classList.remove('hidden');
  $('#agentName').textContent = user.name;
  if (pendingToken) {
    validateToken(pendingToken);
    pendingToken = '';
  }
}

async function checkSession() {
  try {
    const data = await api('/auth/me');
    openApp(data.user);
  } catch {
    $('#loginPage').classList.remove('hidden');
  }
}

function tokenFromRaw(raw) {
  const value = String(raw || '').trim();
  if (!value) {
    return '';
  }
  if (value.startsWith('NVT:')) {
    return value.slice(4);
  }
  try {
    const url = new URL(value);
    return url.searchParams.get('token') || value;
  } catch {
    return value;
  }
}

async function validateToken(raw) {
  try {
    const token = encodeURIComponent(tokenFromRaw(raw));
    const data = await api(`/validate/${token}`);
    renderResult(data);
    message('QR Code validado.', true);
    stopCamera();
  } catch (error) {
    message(error.message);
  }
}

async function manualSearch(event) {
  event.preventDefault();
  try {
    const rawType = $('#searchType').value;
    if (rawType === 'token') {
      await validateToken($('#searchValue').value);
      return;
    }
    const type = encodeURIComponent(rawType);
    const q = encodeURIComponent($('#searchValue').value);
    const data = await api(`/search?type=${type}&q=${q}`);
    renderResult(data);
    message('Consulta realizada.', true);
  } catch (error) {
    message(error.message);
  }
}

function renderResult(data) {
  const panel = $('#resultPanel');
  panel.classList.remove('hidden', 'valid', 'expired');
  const valid = data.aca.situation === 'VALIDA';
  const expired = data.aca.situation === 'EXPIRADA';
  panel.classList.toggle('valid', valid);
  panel.classList.toggle('expired', expired);
  $('#resultTitle').textContent = data.conductor?.name || 'Registro localizado';
  $('#resultMeta').textContent = `${data.origin} · ${new Date(data.validated_at).toLocaleString('pt-BR')}`;
  $('#resultBadge').className = `badge ${valid ? 'success' : expired ? 'danger' : 'warning'}`;
  $('#resultBadge').textContent = data.aca.situation.replace('_', ' ');

  const conductor = data.conductor;
  const guardian = conductor?.legal_guardian;
  const equipment = data.equipment || [];
  const plates = data.plates || [];

  $('#resultContent').innerHTML = `
    <div class="grid two">
      <section>
        <h3>Condutor</h3>
        <div class="data-grid">
          ${dataItem('CPF', conductor?.cpf)}
          ${dataItem('Identificador', conductor?.identifier)}
          ${dataItem('ACA', data.aca.number || 'Não emitida')}
          ${dataItem('Validade', data.aca.valid_until || '-')}
          ${dataItem('Nascimento', conductor?.birth_date)}
          ${dataItem('CNH', conductor?.has_cnh ? 'Possui' : 'Não informada')}
          ${dataItem('Filiação', conductor ? `${conductor.mother_name}${conductor.father_name ? ` / ${conductor.father_name}` : ''}` : '-')}
        </div>
      </section>
      <section>
        <h3>Responsável legal</h3>
        ${
          guardian
            ? `<div class="data-grid">
                ${dataItem('Nome', guardian.name)}
                ${dataItem('CPF', guardian.cpf)}
                ${dataItem('Parentesco', guardian.relationship)}
                ${dataItem('Telefone', guardian.phone)}
              </div>`
            : '<div class="notice">Não aplicável.</div>'
        }
      </section>
    </div>
    <section style="margin-top: 16px">
      <h3>Equipamento vinculado</h3>
      ${
        equipment.length
          ? equipment
              .map(
                (item) => `
                  <div class="list-row">
                    <div>
                      <strong>${escapeHtml(item.manufacturer)} ${escapeHtml(item.model)}</strong>
                      <p>${escapeHtml(item.remia_number)} · ${escapeHtml(item.color)} · Série ${escapeHtml(item.serial_number)}</p>
                      <p>Proprietário: ${escapeHtml(item.owner_name)} · ${escapeHtml(item.owner_cpf_cnpj)}</p>
                    </div>
                  </div>`
              )
              .join('')
          : '<div class="notice">Nenhum equipamento vinculado.</div>'
      }
    </section>
    <section style="margin-top: 16px">
      <h3>Placa PIA</h3>
      ${
        plates.length
          ? plates
              .map(
                (plate) => `
                  <div class="plate-preview">
                    <header><strong>PIA</strong><span>${escapeHtml(plate.municipality)}</span></header>
                    <div class="plate-code">${escapeHtml(plate.code)}</div>
                  </div>`
              )
              .join('')
          : '<div class="notice">Nenhuma PIA emitida.</div>'
      }
    </section>
  `;
}

function dataItem(label, value) {
  return `<div class="data-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '-')}</strong></div>`;
}

async function startCamera() {
  if (!('BarcodeDetector' in window)) {
    $('#scannerStatus').textContent = 'Leitor QR indisponível neste navegador.';
    return;
  }

  detector = detector || new BarcodeDetector({ formats: ['qr_code'] });
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  const video = $('#scannerVideo');
  video.srcObject = stream;
  video.classList.remove('hidden');
  $('#scannerStatus').classList.add('hidden');
  await video.play();
  scanning = true;
  scanLoop();
}

function stopCamera() {
  scanning = false;
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  $('#scannerVideo').classList.add('hidden');
  $('#scannerStatus').classList.remove('hidden');
  $('#scannerStatus').textContent = 'Câmera inativa';
}

async function scanLoop() {
  if (!scanning || !detector) {
    return;
  }
  try {
    const codes = await detector.detect($('#scannerVideo'));
    if (codes.length) {
      await validateToken(codes[0].rawValue);
      return;
    }
  } catch {
    $('#scannerStatus').textContent = 'Falha ao ler a imagem.';
  }
  window.requestAnimationFrame(scanLoop);
}

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('#loginUser').value,
        password: $('#loginPass').value
      })
    });
    $('#loginMessage').textContent = '';
    openApp(data.user);
  } catch (error) {
    $('#loginMessage').textContent = error.message;
  }
});

$('#logoutButton').addEventListener('click', async () => {
  stopCamera();
  await api('/auth/logout', { method: 'POST', body: '{}' }).catch(() => {});
  window.location.reload();
});

$('#manualForm').addEventListener('submit', manualSearch);
$('#cameraButton').addEventListener('click', () => {
  if (stream) {
    stopCamera();
  } else {
    startCamera().catch((error) => {
      $('#scannerStatus').textContent = error.message;
    });
  }
});

checkSession();
