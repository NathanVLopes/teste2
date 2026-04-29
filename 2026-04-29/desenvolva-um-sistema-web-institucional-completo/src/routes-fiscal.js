import {
  all,
  createSession,
  destroySession,
  findSession,
  get,
  logAccess,
  publicUser,
  run
} from './db.js';
import {
  decryptText,
  formatCpfCnpj,
  hashLookup,
  isMinor,
  normalizeDigits,
  todayISO,
  tokenHash,
  verifyPassword
} from './security.js';
import {
  clearSessionCookie,
  getIp,
  methodNotAllowed,
  notFound,
  parseCookies,
  readJson,
  sendError,
  sendJson,
  setSessionCookie
} from './http-utils.js';

const FISCAL_COOKIE = 'navetran_fiscal_session';

function conductorFromRow(row) {
  if (!row) {
    return null;
  }

  const conductor = {
    id: row.id,
    identifier: row.identifier,
    name: row.name,
    birth_date: row.birth_date,
    cpf: formatCpfCnpj(decryptText(row.cpf_encrypted)),
    mother_name: row.mother_name,
    father_name: row.father_name || '',
    photo_data_url: row.photo_data_url || '',
    has_cnh: Boolean(row.has_cnh),
    status: row.status,
    aca_number: row.aca_number || '',
    aca_issue_date: row.aca_issue_date || '',
    aca_valid_until: row.aca_valid_until || '',
    is_minor: isMinor(row.birth_date)
  };

  const guardian = get('SELECT * FROM legal_guardians WHERE conductor_id = ?', [row.id]);
  conductor.legal_guardian = guardian
    ? {
        name: guardian.name,
        cpf: formatCpfCnpj(decryptText(guardian.cpf_encrypted)),
        relationship: guardian.relationship,
        phone: guardian.phone || '',
        document_number: decryptText(guardian.document_number_encrypted)
      }
    : null;

  return conductor;
}

function equipmentFromRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    remia_number: row.remia_number,
    owner_name: row.owner_name,
    owner_cpf_cnpj: formatCpfCnpj(decryptText(row.owner_cpf_cnpj_encrypted)),
    conductor_id: row.conductor_id,
    conductor_name: row.conductor_name || '',
    manufacturer: row.manufacturer,
    model: row.model,
    color: row.color,
    serial_number: row.serial_number,
    provenance_type: row.provenance_type,
    status: row.status
  };
}

function plateFromRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    equipment_id: row.equipment_id,
    code: row.code,
    municipality: row.municipality,
    emission_sequence: row.emission_sequence,
    first_emission_free: Boolean(row.first_emission_free),
    fee_due: Boolean(row.fee_due),
    issue_date: row.issue_date,
    status: row.status
  };
}

function acaSituation(conductor) {
  if (!conductor || !conductor.aca_number) {
    return 'NAO_EMITIDA';
  }
  return conductor.aca_valid_until >= todayISO() ? 'VALIDA' : 'EXPIRADA';
}

function validationPayload({ conductorId = null, equipmentId = null, plateId = null, origin = 'CONSULTA' }) {
  const conductorRow = conductorId ? get('SELECT * FROM conductors WHERE id = ?', [conductorId]) : null;
  const equipmentRows = equipmentId
    ? all(
        `SELECT equipment.*, conductors.name AS conductor_name
         FROM equipment
         JOIN conductors ON conductors.id = equipment.conductor_id
         WHERE equipment.id = ?`,
        [equipmentId]
      )
    : conductorId
      ? all(
          `SELECT equipment.*, conductors.name AS conductor_name
           FROM equipment
           JOIN conductors ON conductors.id = equipment.conductor_id
           WHERE equipment.conductor_id = ?
           ORDER BY equipment.created_at DESC`,
          [conductorId]
        )
      : [];

  let finalConductor = conductorRow;
  if (!finalConductor && equipmentRows[0]) {
    finalConductor = get('SELECT * FROM conductors WHERE id = ?', [equipmentRows[0].conductor_id]);
  }

  const plateRows = plateId
    ? all('SELECT * FROM plates WHERE id = ?', [plateId])
    : equipmentRows[0]
      ? all('SELECT * FROM plates WHERE equipment_id = ? ORDER BY created_at DESC', [equipmentRows[0].id])
      : [];

  const conductor = conductorFromRow(finalConductor);
  return {
    origin,
    validated_at: new Date().toISOString(),
    aca: {
      situation: acaSituation(conductor),
      number: conductor?.aca_number || '',
      issue_date: conductor?.aca_issue_date || '',
      valid_until: conductor?.aca_valid_until || ''
    },
    conductor,
    equipment: equipmentRows.map(equipmentFromRow),
    plates: plateRows.map(plateFromRow)
  };
}

async function currentFiscal(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const user = findSession(cookies[FISCAL_COOKIE], 'fiscal');
  if (!user) {
    sendError(res, 401, 'Sessao de fiscalizacao invalida ou expirada.');
    return null;
  }
  return user;
}

async function login(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res);
    return;
  }

  const body = await readJson(req);
  const user = get(
    "SELECT * FROM users WHERE username = ? AND module = 'fiscal' AND role = 'AGENTE' AND active = 1",
    [body.username || '']
  );

  if (!user || !verifyPassword(body.password || '', user.password_hash)) {
    logAccess('fiscal', null, 'LOGIN_FALHOU', getIp(req), { username: body.username || '' });
    sendError(res, 401, 'Usuario ou senha invalidos.');
    return;
  }

  const session = createSession(user.id, 'fiscal');
  setSessionCookie(res, FISCAL_COOKIE, session.token, session.expires);
  logAccess('fiscal', user.id, 'LOGIN', getIp(req));
  sendJson(res, 200, { user: publicUser(user) });
}

async function logout(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res);
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const user = findSession(cookies[FISCAL_COOKIE], 'fiscal');
  destroySession(cookies[FISCAL_COOKIE], 'fiscal');
  clearSessionCookie(res, FISCAL_COOKIE);
  if (user) {
    logAccess('fiscal', user.id, 'LOGOUT', getIp(req));
  }
  sendJson(res, 200, { ok: true });
}

function extractToken(raw) {
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

function validateToken(req, res, user, rawToken) {
  if (req.method !== 'GET') {
    methodNotAllowed(res);
    return;
  }

  const token = extractToken(rawToken);
  if (!token) {
    sendError(res, 422, 'Token nao informado.');
    return;
  }

  const tokenRow = get('SELECT * FROM qr_tokens WHERE token_hash = ? AND active = 1', [tokenHash(token)]);
  if (!tokenRow) {
    logAccess('fiscal', user.id, 'QR_INVALIDO', getIp(req), { token_prefix: token.slice(0, 8) });
    sendError(res, 404, 'Token nao encontrado ou inativo.');
    return;
  }

  run('UPDATE qr_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?', [tokenRow.id]);
  const payload = validationPayload({
    conductorId: tokenRow.conductor_id,
    equipmentId: tokenRow.equipment_id,
    plateId: tokenRow.plate_id,
    origin: tokenRow.purpose
  });
  logAccess('fiscal', user.id, 'QR_VALIDADO', getIp(req), {
    purpose: tokenRow.purpose,
    token_prefix: tokenRow.token_prefix
  });
  sendJson(res, 200, payload);
}

function search(req, res, user) {
  if (req.method !== 'GET') {
    methodNotAllowed(res);
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const type = String(url.searchParams.get('type') || '').toLowerCase();
  const q = String(url.searchParams.get('q') || '').trim();

  if (!q) {
    sendError(res, 422, 'Informe um termo de consulta.');
    return;
  }

  let payload = null;
  if (type === 'cpf') {
    const row = get('SELECT * FROM conductors WHERE cpf_hash = ?', [hashLookup(normalizeDigits(q))]);
    payload = row ? validationPayload({ conductorId: row.id, origin: 'CPF' }) : null;
  }

  if (type === 'pia') {
    const plate = get('SELECT * FROM plates WHERE code = ?', [q.toUpperCase()]);
    payload = plate
      ? validationPayload({ equipmentId: plate.equipment_id, plateId: plate.id, origin: 'PIA' })
      : null;
  }

  if (type === 'condutor') {
    const row = get('SELECT * FROM conductors WHERE identifier = ? OR aca_number = ?', [q.toUpperCase(), q.toUpperCase()]);
    payload = row ? validationPayload({ conductorId: row.id, origin: 'CONDUTOR' }) : null;
  }

  if (!payload) {
    logAccess('fiscal', user.id, 'CONSULTA_SEM_RESULTADO', getIp(req), { type, q });
    sendError(res, 404, 'Nenhum registro encontrado.');
    return;
  }

  logAccess('fiscal', user.id, 'CONSULTA_REALIZADA', getIp(req), { type, q });
  sendJson(res, 200, payload);
}

export async function handleFiscalApi(req, res, url) {
  const path = url.pathname.replace(/^\/api\/fiscal/, '') || '/';

  try {
    if (path === '/auth/login') {
      await login(req, res);
      return true;
    }

    if (path === '/auth/logout') {
      await logout(req, res);
      return true;
    }

    const user = await currentFiscal(req, res);
    if (!user) {
      return true;
    }

    if (path === '/auth/me') {
      sendJson(res, 200, { user: publicUser(user) });
      return true;
    }

    const tokenMatch = path.match(/^\/validate\/(.+)$/);
    if (tokenMatch) {
      validateToken(req, res, user, decodeURIComponent(tokenMatch[1]));
      return true;
    }

    if (path === '/search') {
      search(req, res, user);
      return true;
    }

    notFound(res);
    return true;
  } catch (error) {
    sendError(res, error.status || 500, error.message || 'Erro interno.');
    return true;
  }
}
