const state = {
  user: null,
  photoDataUrl: '',
  conductors: [],
  equipment: []
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function clientIsMinor(dateText) {
  if (!dateText) {
    return false;
  }
  const birth = new Date(`${dateText}T12:00:00`);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
  if (beforeBirthday) {
    age -= 1;
  }
  return age < 18;
}

async function api(path, options = {}) {
  const response = await fetch(`/api/admin${path}`, {
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Falha na operação.');
  }
  return data;
}

function message(target, text, ok = false) {
  const element = typeof target === 'string' ? $(target) : target;
  if (!element) {
    return;
  }
  element.textContent = text || '';
  element.classList.toggle('ok', Boolean(ok));
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function setView(view) {
  $$('.nav-btn').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $$('.section').forEach((section) => section.classList.toggle('active', section.id === view));
  const titles = {
    dashboard: 'Painel',
    conductors: 'Condutores ACA',
    equipment: 'REMIA e PIA',
    credential: 'Credencial',
    logs: 'Logs'
  };
  $('#viewTitle').textContent = titles[view] || 'Painel';

  if (view === 'dashboard') loadDashboard();
  if (view === 'conductors') loadConductors();
  if (view === 'equipment') {
    loadConductors();
    loadEquipment();
  }
  if (view === 'logs') loadLogs();
}

function openApp(user) {
  state.user = user;
  $('#loginPage').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
  $('#userChip').innerHTML = `<strong>${escapeHtml(user.name)}</strong><br><small>${escapeHtml(user.role)}</small>`;
  $('#statusBadge').textContent = user.role === 'ATENDENTE' ? 'Cadastro' : 'Emissão habilitada';
  setView('dashboard');
}

async function checkSession() {
  try {
    const data = await api('/auth/me');
    openApp(data.user);
  } catch {
    $('#loginPage').classList.remove('hidden');
  }
}

async function loadDashboard() {
  try {
    const data = await api('/dashboard');
    const items = [
      ['Condutores', data.stats.conductors],
      ['ACA emitidas', data.stats.aca_issued],
      ['REMIA', data.stats.equipment],
      ['PIA ativas', data.stats.plates]
    ];
    $('#statsGrid').innerHTML = items
      .map(([label, total]) => `<div class="stat"><span>${label}</span><strong>${total}</strong></div>`)
      .join('');
    $('#dashboardNotice').className = `notice ${data.monthly_rule.compliant ? 'success' : 'warning'}`;
    $('#dashboardNotice').textContent = data.monthly_rule.message;
    $('#recentLogs').innerHTML = data.recent_logs.length
      ? data.recent_logs
          .map(
            (log) => `
              <div class="list-row">
                <div>
                  <strong>${escapeHtml(log.action)}</strong>
                  <p>${escapeHtml(log.created_at)} · ${escapeHtml(log.module)} · ${escapeHtml(log.user_name || 'Sistema')}</p>
                </div>
              </div>`
          )
          .join('')
      : '<div class="notice">Sem atividade registrada.</div>';
  } catch (error) {
    $('#dashboardNotice').className = 'notice danger';
    $('#dashboardNotice').textContent = error.message;
  }
}

async function loadConductors() {
  const search = encodeURIComponent($('#conductorSearch')?.value || '');
  const data = await api(`/conductors${search ? `?search=${search}` : ''}`);
  state.conductors = data.conductors;
  renderConductorOptions();
  renderConductors();
}

function renderConductorOptions() {
  const select = $('#equipmentConductor');
  if (!select) {
    return;
  }
  select.innerHTML = state.conductors.length
    ? state.conductors
        .map(
          (conductor) =>
            `<option value="${conductor.id}">${escapeHtml(conductor.name)} · ${escapeHtml(conductor.identifier)}</option>`
        )
        .join('')
    : '<option value="">Cadastre um condutor</option>';
}

function renderConductors() {
  const list = $('#conductorList');
  if (!state.conductors.length) {
    list.innerHTML = '<div class="notice">Nenhum condutor encontrado.</div>';
    return;
  }

  list.innerHTML = state.conductors
    .map((conductor) => {
      const issued = conductor.status === 'ACA_EMITIDA';
      const minor = conductor.is_minor ? '<span class="badge warning">Menor de idade</span>' : '';
      return `
        <article class="list-row">
          <div>
            <strong>${escapeHtml(conductor.name)}</strong>
            <p>${escapeHtml(conductor.identifier)} · CPF ${escapeHtml(conductor.cpf)} · ${escapeHtml(conductor.status)}</p>
            ${minor} ${issued ? `<span class="badge success">${escapeHtml(conductor.aca_number)}</span>` : ''}
          </div>
          <div class="row-actions">
            <button class="btn secondary" data-action="exam" data-id="${conductor.id}" type="button">Prova aprovada</button>
            <button class="btn" data-action="aca" data-id="${conductor.id}" type="button">Emitir ACA</button>
          </div>
        </article>
      `;
    })
    .join('');
}

async function loadEquipment() {
  const search = encodeURIComponent($('#equipmentSearch')?.value || '');
  const data = await api(`/equipment${search ? `?search=${search}` : ''}`);
  state.equipment = data.equipment;
  renderEquipment();
}

function renderEquipment() {
  const list = $('#equipmentList');
  if (!state.equipment.length) {
    list.innerHTML = '<div class="notice">Nenhum equipamento encontrado.</div>';
    return;
  }

  list.innerHTML = state.equipment
    .map(
      (item) => `
        <article class="list-row">
          <div>
            <strong>${escapeHtml(item.manufacturer)} ${escapeHtml(item.model)}</strong>
            <p>${escapeHtml(item.remia_number)} · Série ${escapeHtml(item.serial_number)} · Condutor ${escapeHtml(
              item.conductor_name
            )}</p>
            <span class="badge">${escapeHtml(item.status)}</span>
          </div>
          <div class="row-actions">
            <button class="btn" data-action="pia" data-id="${item.id}" type="button">Emitir PIA</button>
          </div>
        </article>
      `
    )
    .join('');
}

async function loadLogs() {
  const data = await api('/logs');
  $('#logsTable').innerHTML = data.logs
    .map(
      (log) => `
        <tr>
          <td>${escapeHtml(log.created_at)}</td>
          <td>${escapeHtml(log.module)}</td>
          <td>${escapeHtml(log.action)}</td>
          <td>${escapeHtml(log.user_name || 'Sistema')}</td>
          <td>${escapeHtml(log.details || '')}</td>
        </tr>
      `
    )
    .join('');
}

function renderCredential(data) {
  $('#credentialEmpty').classList.add('hidden');
  const container = $('#credentialPreview');

  if (data.credential) {
    const conductor = data.conductor;
    container.innerHTML = `
      <div class="credential">
        <div class="credential-head">
          <div>
            <strong>NAVETRAN · Prefeitura de Navegantes</strong><br />
            <span>Autorização para Conduzir Autopropelidos</span>
          </div>
          <span class="badge success">${escapeHtml(data.credential.situation)}</span>
        </div>
        <div class="credential-body">
          <div class="photo-box">${
            conductor.photo_data_url
              ? `<img alt="Foto do condutor" src="${conductor.photo_data_url}" />`
              : 'FOTO'
          }</div>
          <div class="data-grid">
            ${dataItem('Nome', conductor.name)}
            ${dataItem('CPF', conductor.cpf)}
            ${dataItem('Identificador', conductor.identifier)}
            ${dataItem('ACA', data.credential.number)}
            ${dataItem('Nascimento', conductor.birth_date)}
            ${dataItem('Emissão', data.credential.issue_date)}
            ${dataItem('Validade', data.credential.valid_until)}
            ${dataItem('Filiação', `${conductor.mother_name}${conductor.father_name ? ` / ${conductor.father_name}` : ''}`)}
            ${
              conductor.legal_guardian
                ? dataItem('Responsável legal', `${conductor.legal_guardian.name} · ${conductor.legal_guardian.cpf}`)
                : ''
            }
          </div>
          <div class="qr-box">
            <div id="credentialQr"></div>
            <small>Token ${escapeHtml(data.credential.token_prefix)}</small>
          </div>
        </div>
      </div>
    `;
    NavetranQr.render(data.credential.qr_payload, '#credentialQr');
  } else if (data.plate) {
    container.innerHTML = `
      <div class="grid two">
        <div class="plate-preview">
          <header>
            <strong>PIA</strong>
            <span>${escapeHtml(data.plate.municipality)}</span>
          </header>
          <div class="plate-code">${escapeHtml(data.plate.code)}</div>
        </div>
        <div class="pia-details">
          <h2>Placa de Identificação de Autopropelido</h2>
          <div class="data-grid">
            ${dataItem('REMIA', data.equipment.remia_number)}
            ${dataItem('Equipamento', `${data.equipment.manufacturer} ${data.equipment.model}`)}
            ${dataItem('Condutor', data.conductor.name)}
            ${dataItem('Emissão', data.plate.issue_date)}
            ${dataItem('Primeira emissão', data.plate.first_emission_free ? 'Gratuita' : 'Reemissão')}
            ${dataItem('Cobrança', data.plate.fee_due ? 'Passível de cobrança' : 'Sem cobrança')}
          </div>
          <div class="qr-box" style="margin-top: 14px">
            <div id="credentialQr"></div>
          </div>
        </div>
      </div>
    `;
    NavetranQr.render(data.plate.qr_payload, '#credentialQr');
  }

  setView('credential');
}

function dataItem(label, value) {
  return `<div class="data-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '-')}</strong></div>`;
}

async function submitConductor(event) {
  event.preventDefault();
  const raw = formData(event.currentTarget);
  const payload = {
    name: raw.name,
    birth_date: raw.birth_date,
    cpf: raw.cpf,
    mother_name: raw.mother_name,
    father_name: raw.father_name,
    photo_data_url: state.photoDataUrl,
    residence_address: raw.residence_address,
    residence_proof_date: raw.residence_proof_date,
    id_document_type: raw.id_document_type,
    id_document_number: raw.id_document_number,
    id_document_file_name: raw.id_document_file_name,
    has_cnh: raw.has_cnh === 'on'
  };
  if (clientIsMinor(raw.birth_date)) {
    payload.legal_guardian = {
      name: raw.guardian_name,
      cpf: raw.guardian_cpf,
      relationship: raw.guardian_relationship,
      phone: raw.guardian_phone,
      document_number: raw.guardian_document_number
    };
  }

  try {
    await api('/conductors', { method: 'POST', body: JSON.stringify(payload) });
    event.currentTarget.reset();
    state.photoDataUrl = '';
    toggleGuardian();
    message('#conductorMessage', 'Condutor cadastrado com sucesso.', true);
    await loadConductors();
  } catch (error) {
    message('#conductorMessage', error.message);
  }
}

async function submitEquipment(event) {
  event.preventDefault();
  const payload = formData(event.currentTarget);
  try {
    await api('/equipment', { method: 'POST', body: JSON.stringify(payload) });
    event.currentTarget.reset();
    message('#equipmentMessage', 'Equipamento registrado com sucesso.', true);
    await loadEquipment();
  } catch (error) {
    message('#equipmentMessage', error.message);
  }
}

function toggleGuardian() {
  const birthDate = $('[name="birth_date"]').value;
  const show = clientIsMinor(birthDate);
  $('#guardianTitle').classList.toggle('hidden', !show);
  $('#guardianFields').classList.toggle('hidden', !show);
  $('#guardianFields')
    .querySelectorAll('input')
    .forEach((input) => {
      input.required = show && ['guardian_name', 'guardian_cpf', 'guardian_relationship', 'guardian_document_number'].includes(input.name);
    });
}

async function conductorAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }
  const id = Number(button.dataset.id);
  const action = button.dataset.action;

  try {
    if (action === 'exam') {
      const scheduledDate = window.prompt('Data da prova teórica aprovada', today());
      if (!scheduledDate) {
        return;
      }
      await api(`/conductors/${id}/exams`, {
        method: 'POST',
        body: JSON.stringify({
          scheduled_date: scheduledDate,
          result: 'APROVADA',
          score: 100,
          notes: 'Aprovação registrada pelo módulo administrativo.'
        })
      });
      message('#conductorMessage', 'Aprovação registrada.', true);
      await loadDashboard();
    }

    if (action === 'aca') {
      const data = await api(`/conductors/${id}/issue-aca`, { method: 'POST', body: '{}' });
      renderCredential(data);
    }
  } catch (error) {
    message('#conductorMessage', error.message);
  }
}

async function equipmentAction(event) {
  const button = event.target.closest('button[data-action="pia"]');
  if (!button) {
    return;
  }
  try {
    const data = await api(`/equipment/${Number(button.dataset.id)}/plates`, { method: 'POST', body: '{}' });
    renderCredential(data);
  } catch (error) {
    message('#equipmentMessage', error.message);
  }
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
    message('#loginMessage', '');
    openApp(data.user);
  } catch (error) {
    message('#loginMessage', error.message);
  }
});

$('#logoutButton').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST', body: '{}' }).catch(() => {});
  window.location.reload();
});

$$('.nav-btn').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
$('#conductorForm').addEventListener('submit', submitConductor);
$('#equipmentForm').addEventListener('submit', submitEquipment);
$('#conductorList').addEventListener('click', conductorAction);
$('#equipmentList').addEventListener('click', equipmentAction);
$('#refreshConductors').addEventListener('click', loadConductors);
$('#refreshEquipment').addEventListener('click', loadEquipment);
$('#refreshLogs').addEventListener('click', loadLogs);
$('#conductorSearch').addEventListener('input', () => loadConductors().catch(() => {}));
$('#equipmentSearch').addEventListener('input', () => loadEquipment().catch(() => {}));
$('[name="birth_date"]').addEventListener('change', toggleGuardian);

$('#photoInput').addEventListener('change', (event) => {
  const [file] = event.target.files;
  if (!file) {
    state.photoDataUrl = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    state.photoDataUrl = String(reader.result || '');
  };
  reader.readAsDataURL(file);
});

checkSession();
