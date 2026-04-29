import { randomBytes } from 'node:crypto';
import {
  all,
  createSession,
  db,
  destroySession,
  findSession,
  get,
  logAccess,
  publicUser,
  run
} from './db.js';
import { config } from './config.js';
import {
  addYears,
  daysBetween,
  decryptText,
  encryptText,
  formatCpfCnpj,
  hashLookup,
  isMinor,
  normalizeDigits,
  secureToken,
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

const ADMIN_COOKIE = 'navetran_admin_session';
const CAN_EMIT = new Set(['ADMIN', 'GESTOR']);

function randomAlnum(size = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = randomBytes(size * 2);
  for (const byte of bytes) {
    code += alphabet[byte % alphabet.length];
    if (code.length === size) {
      break;
    }
  }
  return code;
}

function uniqueCode(prefix, table, column, size = 6) {
  let code = '';
  do {
    code = `${prefix}-${new Date().getFullYear()}-${randomAlnum(size)}`;
  } while (get(`SELECT id FROM ${table} WHERE ${column} = ?`, [code]));
  return code;
}

function requireFields(body, fields) {
  const missing = fields.filter((field) => !String(body[field] ?? '').trim());
  if (missing.length) {
    throw Object.assign(new Error(`Campos obrigatórios: ${missing.join(', ')}.`), { status: 422 });
  }
}

function assertRecentProof(dateText, label) {
  const age = daysBetween(dateText);
  if (!dateText || age < 0 || age > config.residenceProofMaxAgeDays) {
    throw Object.assign(
      new Error(`${label} deve ter sido emitido nos ultimos ${config.residenceProofMaxAgeDays} dias.`),
      { status: 422 }
    );
  }
}

function requireEmitter(user) {
  if (!CAN_EMIT.has(user.role)) {
    throw Object.assign(new Error('Permissao insuficiente para emissao.'), { status: 403 });
  }
}

function conductorFromRow(row, includeGuardian = true) {
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
    residence_address: row.residence_address,
    residence_proof_date: row.residence_proof_date,
    id_document_type: row.id_document_type,
    id_document_number: decryptText(row.id_document_number_encrypted),
    id_document_file_name: row.id_document_file_name || '',
    has_cnh: Boolean(row.has_cnh),
    status: row.status,
    aca_number: row.aca_number || '',
    aca_issue_date: row.aca_issue_date || '',
    aca_valid_until: row.aca_valid_until || '',
    is_minor: isMinor(row.birth_date),
    created_at: row.created_at,
    updated_at: row.updated_at
  };

  if (includeGuardian) {
    const guardian = get('SELECT * FROM legal_guardians WHERE conductor_id = ?', [row.id]);
    conductor.legal_guardian = guardian
      ? {
          id: guardian.id,
          name: guardian.name,
          cpf: formatCpfCnpj(decryptText(guardian.cpf_encrypted)),
          relationship: guardian.relationship,
          phone: guardian.phone || '',
          document_number: decryptText(guardian.document_number_encrypted)
        }
      : null;
  }

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
    owner_document: decryptText(row.owner_document_encrypted),
    owner_residence_address: row.owner_residence_address,
    owner_residence_proof_date: row.owner_residence_proof_date,
    conductor_id: row.conductor_id,
    conductor_name: row.conductor_name || '',
    conductor_identifier: row.conductor_identifier || '',
    manufacturer: row.manufacturer,
    model: row.model,
    color: row.color,
    serial_number: row.serial_number,
    provenance_type: row.provenance_type,
    provenance_document: row.provenance_document,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function plateFromRow(row, includeToken = false) {
  if (!row) {
    return null;
  }

  const plate = {
    id: row.id,
    equipment_id: row.equipment_id,
    code: row.code,
    municipality: row.municipality,
    emission_sequence: row.emission_sequence,
    first_emission_free: Boolean(row.first_emission_free),
    fee_due: Boolean(row.fee_due),
    issue_date: row.issue_date,
    status: row.status,
    qr_token_id: row.qr_token_id
  };

  if (includeToken && row.token_encrypted) {
    const token = decryptText(row.token_encrypted);
    plate.qr_token = token;
    plate.qr_payload = `NVT:${token}`;
  }

  return plate;
}

function createQrToken({ purpose, conductorId = null, equipmentId = null, plateId = null }) {
  const token = secureToken(32);
  const result = run(
    `INSERT INTO qr_tokens (
      token_hash,
      token_encrypted,
      token_prefix,
      purpose,
      conductor_id,
      equipment_id,
      plate_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      tokenHash(token),
      encryptText(token),
      token.slice(0, 10),
      purpose,
      conductorId,
      equipmentId,
      plateId
    ]
  );

  return { id: Number(result.lastInsertRowid), token };
}

async function currentAdmin(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const user = findSession(cookies[ADMIN_COOKIE], 'admin');
  if (!user) {
    sendError(res, 401, 'Sessao administrativa invalida ou expirada.');
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
  const user = get('SELECT * FROM users WHERE username = ? AND module = ? AND active = 1', [
    body.username || '',
    'admin'
  ]);

  if (!user || !verifyPassword(body.password || '', user.password_hash)) {
    logAccess('admin', null, 'LOGIN_FALHOU', getIp(req), { username: body.username || '' });
    sendError(res, 401, 'Usuario ou senha invalidos.');
    return;
  }

  const session = createSession(user.id, 'admin');
  setSessionCookie(res, ADMIN_COOKIE, session.token, session.expires);
  logAccess('admin', user.id, 'LOGIN', getIp(req));
  sendJson(res, 200, { user: publicUser(user) });
}

async function logout(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res);
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const user = findSession(cookies[ADMIN_COOKIE], 'admin');
  destroySession(cookies[ADMIN_COOKIE], 'admin');
  clearSessionCookie(res, ADMIN_COOKIE);
  if (user) {
    logAccess('admin', user.id, 'LOGOUT', getIp(req));
  }
  sendJson(res, 200, { ok: true });
}

function dashboard(req, res, user) {
  if (req.method !== 'GET') {
    methodNotAllowed(res);
    return;
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10);

  const stats = {
    conductors: get('SELECT COUNT(*) AS total FROM conductors').total,
    aca_issued: get("SELECT COUNT(*) AS total FROM conductors WHERE status = 'ACA_EMITIDA'").total,
    equipment: get('SELECT COUNT(*) AS total FROM equipment').total,
    plates: get("SELECT COUNT(*) AS total FROM plates WHERE status = 'ATIVA'").total,
    exams_this_month: get(
      'SELECT COUNT(*) AS total FROM exams WHERE scheduled_date >= ? AND scheduled_date < ?',
      [monthStart, nextMonth]
    ).total,
    pending_exam: get(`
      SELECT COUNT(*) AS total
      FROM conductors c
      WHERE c.status <> 'ACA_EMITIDA'
        AND NOT EXISTS (
          SELECT 1 FROM exams e WHERE e.conductor_id = c.id AND e.result = 'APROVADA'
        )
    `).total
  };

  const recentLogs = all(
    `SELECT access_logs.created_at, access_logs.module, access_logs.action, users.name AS user_name
     FROM access_logs
     LEFT JOIN users ON users.id = access_logs.user_id
     ORDER BY access_logs.created_at DESC
     LIMIT 8`
  );

  logAccess('admin', user.id, 'DASHBOARD', getIp(req));
  sendJson(res, 200, {
    stats,
    monthly_rule: {
      month: monthStart.slice(0, 7),
      compliant: stats.exams_this_month > 0,
      message:
        stats.exams_this_month > 0
          ? 'Ha prova teorica registrada para o mes corrente.'
          : 'Nao ha prova teorica registrada para o mes corrente.'
    },
    recent_logs: recentLogs
  });
}

function listConductors(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const search = String(url.searchParams.get('search') || '').trim();
  let rows;

  if (search) {
    const cpfHash = hashLookup(normalizeDigits(search));
    rows = all(
      `SELECT * FROM conductors
       WHERE cpf_hash = ?
          OR identifier LIKE ?
          OR aca_number LIKE ?
          OR name LIKE ?
       ORDER BY created_at DESC
       LIMIT 80`,
      [cpfHash, `%${search}%`, `%${search}%`, `%${search}%`]
    );
  } else {
    rows = all('SELECT * FROM conductors ORDER BY created_at DESC LIMIT 80');
  }

  sendJson(res, 200, { conductors: rows.map((row) => conductorFromRow(row, false)) });
}

async function createConductor(req, res, user) {
  const body = await readJson(req);
  requireFields(body, [
    'name',
    'birth_date',
    'cpf',
    'mother_name',
    'residence_address',
    'residence_proof_date',
    'id_document_type',
    'id_document_number'
  ]);
  assertRecentProof(body.residence_proof_date, 'Comprovante de residencia do condutor');

  const cpfDigits = normalizeDigits(body.cpf);
  if (cpfDigits.length !== 11) {
    throw Object.assign(new Error('CPF do condutor deve conter 11 digitos.'), { status: 422 });
  }

  const minor = isMinor(body.birth_date);
  if (minor) {
    requireFields(body.legal_guardian || {}, ['name', 'cpf', 'relationship', 'document_number']);
  }

  const identifier = uniqueCode('COND', 'conductors', 'identifier', 6);
  let conductorId;

  db.exec('BEGIN');
  try {
    const inserted = run(
      `INSERT INTO conductors (
        identifier,
        name,
        birth_date,
        cpf_encrypted,
        cpf_hash,
        mother_name,
        father_name,
        photo_data_url,
        residence_address,
        residence_proof_date,
        id_document_type,
        id_document_number_encrypted,
        id_document_file_name,
        has_cnh,
        created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        identifier,
        body.name.trim(),
        body.birth_date,
        encryptText(cpfDigits),
        hashLookup(cpfDigits),
        body.mother_name.trim(),
        String(body.father_name || '').trim(),
        String(body.photo_data_url || ''),
        body.residence_address.trim(),
        body.residence_proof_date,
        body.id_document_type,
        encryptText(body.id_document_number),
        String(body.id_document_file_name || '').trim(),
        body.has_cnh ? 1 : 0,
        user.id
      ]
    );
    conductorId = Number(inserted.lastInsertRowid);

    if (minor) {
      const guardianCpf = normalizeDigits(body.legal_guardian.cpf);
      run(
        `INSERT INTO legal_guardians (
          conductor_id,
          name,
          cpf_encrypted,
          cpf_hash,
          relationship,
          phone,
          document_number_encrypted
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          conductorId,
          body.legal_guardian.name.trim(),
          encryptText(guardianCpf),
          hashLookup(guardianCpf),
          body.legal_guardian.relationship.trim(),
          String(body.legal_guardian.phone || '').trim(),
          encryptText(body.legal_guardian.document_number)
        ]
      );
    }

    run(
      `INSERT INTO documents (entity_type, entity_id, kind, file_name, issued_at, metadata)
       VALUES ('CONDUTOR', ?, 'DOCUMENTO_IDENTIFICACAO', ?, ?, ?)`,
      [
        conductorId,
        String(body.id_document_file_name || body.id_document_type),
        todayISO(),
        JSON.stringify({ type: body.id_document_type })
      ]
    );
    run(
      `INSERT INTO documents (entity_type, entity_id, kind, file_name, issued_at)
       VALUES ('CONDUTOR', ?, 'COMPROVANTE_RESIDENCIA', ?, ?)`,
      [conductorId, 'Comprovante de residencia', body.residence_proof_date]
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    if (String(error.message).includes('UNIQUE')) {
      throw Object.assign(new Error('Ja existe cadastro para este CPF.'), { status: 409 });
    }
    throw error;
  }

  logAccess('admin', user.id, 'CONDUTOR_CADASTRADO', getIp(req), { conductor_id: conductorId });
  const row = get('SELECT * FROM conductors WHERE id = ?', [conductorId]);
  sendJson(res, 201, { conductor: conductorFromRow(row) });
}

function getConductor(req, res, id) {
  const row = get('SELECT * FROM conductors WHERE id = ?', [id]);
  if (!row) {
    notFound(res);
    return;
  }

  const exams = all('SELECT * FROM exams WHERE conductor_id = ? ORDER BY scheduled_date DESC', [id]);
  const equipment = all(
    `SELECT equipment.*, conductors.name AS conductor_name, conductors.identifier AS conductor_identifier
     FROM equipment
     JOIN conductors ON conductors.id = equipment.conductor_id
     WHERE equipment.conductor_id = ?
     ORDER BY equipment.created_at DESC`,
    [id]
  ).map(equipmentFromRow);

  sendJson(res, 200, { conductor: conductorFromRow(row), exams, equipment });
}

async function registerExam(req, res, user, id) {
  const body = await readJson(req);
  requireFields(body, ['scheduled_date', 'result']);
  if (!['AGENDADA', 'APROVADA', 'REPROVADA'].includes(body.result)) {
    throw Object.assign(new Error('Resultado de prova invalido.'), { status: 422 });
  }

  const conductor = get('SELECT id FROM conductors WHERE id = ?', [id]);
  if (!conductor) {
    notFound(res);
    return;
  }

  const inserted = run(
    `INSERT INTO exams (conductor_id, scheduled_date, result, score, notes, registered_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, body.scheduled_date, body.result, Number(body.score || 0), String(body.notes || ''), user.id]
  );

  logAccess('admin', user.id, 'PROVA_REGISTRADA', getIp(req), {
    conductor_id: id,
    exam_id: Number(inserted.lastInsertRowid),
    result: body.result
  });
  sendJson(res, 201, {
    exam: get('SELECT * FROM exams WHERE id = ?', [Number(inserted.lastInsertRowid)])
  });
}

function credentialForConductor(conductorId) {
  const conductorRow = get('SELECT * FROM conductors WHERE id = ?', [conductorId]);
  if (!conductorRow) {
    return null;
  }

  const tokenRow = conductorRow.aca_token_id
    ? get('SELECT * FROM qr_tokens WHERE id = ?', [conductorRow.aca_token_id])
    : null;
  const equipmentRows = all(
    `SELECT equipment.*, conductors.name AS conductor_name, conductors.identifier AS conductor_identifier
     FROM equipment
     JOIN conductors ON conductors.id = equipment.conductor_id
     WHERE equipment.conductor_id = ?
     ORDER BY equipment.created_at DESC`,
    [conductorId]
  ).map(equipmentFromRow);

  const token = tokenRow ? decryptText(tokenRow.token_encrypted) : '';
  return {
    conductor: conductorFromRow(conductorRow),
    equipment: equipmentRows,
    credential: {
      type: 'ACA',
      number: conductorRow.aca_number,
      issue_date: conductorRow.aca_issue_date,
      valid_until: conductorRow.aca_valid_until,
      situation:
        conductorRow.aca_valid_until && conductorRow.aca_valid_until >= todayISO() ? 'VALIDA' : 'EXPIRADA',
      qr_payload: token ? `NVT:${token}` : '',
      token_prefix: token ? token.slice(0, 10) : ''
    }
  };
}

async function issueAca(req, res, user, id) {
  if (req.method !== 'POST') {
    methodNotAllowed(res);
    return;
  }
  requireEmitter(user);

  const conductor = get('SELECT * FROM conductors WHERE id = ?', [id]);
  if (!conductor) {
    notFound(res);
    return;
  }

  if (conductor.has_cnh) {
    throw Object.assign(new Error('ACA e obrigatoria para condutores sem CNH. Este cadastro esta marcado com CNH.'), {
      status: 422
    });
  }

  assertRecentProof(conductor.residence_proof_date, 'Comprovante de residencia do condutor');

  if (isMinor(conductor.birth_date) && !get('SELECT id FROM legal_guardians WHERE conductor_id = ?', [id])) {
    throw Object.assign(new Error('Responsavel legal e obrigatorio para condutor menor de 18 anos.'), {
      status: 422
    });
  }

  const approvedExam = get(
    "SELECT id FROM exams WHERE conductor_id = ? AND result = 'APROVADA' ORDER BY scheduled_date DESC LIMIT 1",
    [id]
  );
  if (!approvedExam) {
    throw Object.assign(new Error('Aprovacao em prova teorica da NAVETRAN e obrigatoria para emissao da ACA.'), {
      status: 422
    });
  }

  if (conductor.aca_number && conductor.aca_token_id) {
    sendJson(res, 200, credentialForConductor(id));
    return;
  }

  const issueDate = todayISO();
  const validUntil = addYears(issueDate, config.acaValidityYears);
  const acaNumber = uniqueCode('ACA', 'conductors', 'aca_number', 7);
  const qrToken = createQrToken({ purpose: 'ACA', conductorId: id });

  run(
    `UPDATE conductors
     SET status = 'ACA_EMITIDA',
         aca_number = ?,
         aca_issue_date = ?,
         aca_valid_until = ?,
         aca_token_id = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [acaNumber, issueDate, validUntil, qrToken.id, id]
  );

  logAccess('admin', user.id, 'ACA_EMITIDA', getIp(req), {
    conductor_id: id,
    aca_number: acaNumber,
    gratuita: true,
    valid_until: validUntil
  });
  sendJson(res, 201, credentialForConductor(id));
}

function listEquipment(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const search = String(url.searchParams.get('search') || '').trim();
  let rows;

  if (search) {
    const ownerHash = hashLookup(normalizeDigits(search));
    rows = all(
      `SELECT equipment.*, conductors.name AS conductor_name, conductors.identifier AS conductor_identifier
       FROM equipment
       JOIN conductors ON conductors.id = equipment.conductor_id
       WHERE equipment.owner_cpf_cnpj_hash = ?
          OR equipment.remia_number LIKE ?
          OR equipment.serial_number LIKE ?
          OR conductors.name LIKE ?
       ORDER BY equipment.created_at DESC
       LIMIT 80`,
      [ownerHash, `%${search}%`, `%${search}%`, `%${search}%`]
    );
  } else {
    rows = all(
      `SELECT equipment.*, conductors.name AS conductor_name, conductors.identifier AS conductor_identifier
       FROM equipment
       JOIN conductors ON conductors.id = equipment.conductor_id
       ORDER BY equipment.created_at DESC
       LIMIT 80`
    );
  }

  sendJson(res, 200, { equipment: rows.map(equipmentFromRow) });
}

async function createEquipment(req, res, user) {
  const body = await readJson(req);
  requireFields(body, [
    'owner_name',
    'owner_cpf_cnpj',
    'owner_document',
    'owner_residence_address',
    'owner_residence_proof_date',
    'conductor_id',
    'manufacturer',
    'model',
    'color',
    'serial_number',
    'provenance_type',
    'provenance_document'
  ]);
  assertRecentProof(body.owner_residence_proof_date, 'Comprovante de residencia do proprietario');

  const cpfCnpjDigits = normalizeDigits(body.owner_cpf_cnpj);
  if (![11, 14].includes(cpfCnpjDigits.length)) {
    throw Object.assign(new Error('CPF/CNPJ do proprietario deve conter 11 ou 14 digitos.'), { status: 422 });
  }

  if (!['NOTA_FISCAL', 'DECLARACAO'].includes(body.provenance_type)) {
    throw Object.assign(new Error('Procedencia deve ser nota fiscal ou declaracao.'), { status: 422 });
  }

  const conductor = get('SELECT id FROM conductors WHERE id = ?', [Number(body.conductor_id)]);
  if (!conductor) {
    throw Object.assign(new Error('Condutor principal nao encontrado.'), { status: 422 });
  }

  const remia = uniqueCode('REMIA', 'equipment', 'remia_number', 7);
  const inserted = run(
    `INSERT INTO equipment (
      remia_number,
      owner_name,
      owner_cpf_cnpj_encrypted,
      owner_cpf_cnpj_hash,
      owner_document_encrypted,
      owner_residence_address,
      owner_residence_proof_date,
      conductor_id,
      manufacturer,
      model,
      color,
      serial_number,
      provenance_type,
      provenance_document,
      created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      remia,
      body.owner_name.trim(),
      encryptText(cpfCnpjDigits),
      hashLookup(cpfCnpjDigits),
      encryptText(body.owner_document),
      body.owner_residence_address.trim(),
      body.owner_residence_proof_date,
      Number(body.conductor_id),
      body.manufacturer.trim(),
      body.model.trim(),
      body.color.trim(),
      body.serial_number.trim(),
      body.provenance_type,
      body.provenance_document.trim(),
      user.id
    ]
  );

  const equipmentId = Number(inserted.lastInsertRowid);
  run(
    `INSERT INTO documents (entity_type, entity_id, kind, file_name, issued_at, metadata)
     VALUES ('EQUIPAMENTO', ?, 'PROCEDENCIA', ?, ?, ?)`,
    [
      equipmentId,
      body.provenance_document.trim(),
      todayISO(),
      JSON.stringify({ type: body.provenance_type })
    ]
  );
  run(
    `INSERT INTO documents (entity_type, entity_id, kind, file_name, issued_at)
     VALUES ('EQUIPAMENTO', ?, 'COMPROVANTE_RESIDENCIA_PROPRIETARIO', ?, ?)`,
    [equipmentId, 'Comprovante de residencia do proprietario', body.owner_residence_proof_date]
  );

  logAccess('admin', user.id, 'REMIA_REGISTRADO', getIp(req), {
    equipment_id: equipmentId,
    remia_number: remia
  });
  const row = get(
    `SELECT equipment.*, conductors.name AS conductor_name, conductors.identifier AS conductor_identifier
     FROM equipment
     JOIN conductors ON conductors.id = equipment.conductor_id
     WHERE equipment.id = ?`,
    [equipmentId]
  );
  sendJson(res, 201, { equipment: equipmentFromRow(row) });
}

function credentialForPlate(plateId) {
  const row = get(
    `SELECT plates.*, qr_tokens.token_encrypted
     FROM plates
     LEFT JOIN qr_tokens ON qr_tokens.id = plates.qr_token_id
     WHERE plates.id = ?`,
    [plateId]
  );
  if (!row) {
    return null;
  }

  const equipmentRow = get(
    `SELECT equipment.*, conductors.name AS conductor_name, conductors.identifier AS conductor_identifier
     FROM equipment
     JOIN conductors ON conductors.id = equipment.conductor_id
     WHERE equipment.id = ?`,
    [row.equipment_id]
  );

  const conductor = equipmentRow ? get('SELECT * FROM conductors WHERE id = ?', [equipmentRow.conductor_id]) : null;
  return {
    plate: plateFromRow(row, true),
    equipment: equipmentFromRow(equipmentRow),
    conductor: conductorFromRow(conductor)
  };
}

async function issuePlate(req, res, user, equipmentId) {
  if (req.method !== 'POST') {
    methodNotAllowed(res);
    return;
  }
  requireEmitter(user);

  const equipment = get('SELECT * FROM equipment WHERE id = ?', [equipmentId]);
  if (!equipment) {
    notFound(res);
    return;
  }

  const currentCount = get('SELECT COUNT(*) AS total FROM plates WHERE equipment_id = ?', [equipmentId]).total;
  let code = '';
  do {
    code = `${config.platePrefix}-${randomAlnum(3)}${randomAlnum(3)}`;
  } while (get('SELECT id FROM plates WHERE code = ?', [code]));

  const qrToken = createQrToken({
    purpose: 'PIA',
    conductorId: equipment.conductor_id,
    equipmentId
  });
  const inserted = run(
    `INSERT INTO plates (
      equipment_id,
      code,
      municipality,
      emission_sequence,
      first_emission_free,
      fee_due,
      issue_date,
      qr_token_id,
      created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      equipmentId,
      code,
      config.municipality,
      currentCount + 1,
      currentCount === 0 ? 1 : 0,
      currentCount === 0 ? 0 : 1,
      todayISO(),
      qrToken.id,
      user.id
    ]
  );
  const plateId = Number(inserted.lastInsertRowid);
  run('UPDATE qr_tokens SET plate_id = ? WHERE id = ?', [plateId, qrToken.id]);

  logAccess('admin', user.id, 'PIA_EMITIDA', getIp(req), {
    equipment_id: equipmentId,
    plate_id: plateId,
    code,
    primeira_emissao_gratuita: currentCount === 0,
    cobranca_devida: currentCount > 0
  });
  sendJson(res, 201, credentialForPlate(plateId));
}

function getCredential(req, res, type, id) {
  if (req.method !== 'GET') {
    methodNotAllowed(res);
    return;
  }

  const credential = type === 'aca' ? credentialForConductor(id) : credentialForPlate(id);
  if (!credential) {
    notFound(res);
    return;
  }
  sendJson(res, 200, credential);
}

function logs(req, res) {
  if (req.method !== 'GET') {
    methodNotAllowed(res);
    return;
  }

  const rows = all(
    `SELECT access_logs.*, users.name AS user_name
     FROM access_logs
     LEFT JOIN users ON users.id = access_logs.user_id
     ORDER BY access_logs.created_at DESC
     LIMIT 120`
  );
  sendJson(res, 200, { logs: rows });
}

export async function handleAdminApi(req, res, url) {
  const path = url.pathname.replace(/^\/api\/admin/, '') || '/';

  try {
    if (path === '/auth/login') {
      await login(req, res);
      return true;
    }

    if (path === '/auth/logout') {
      await logout(req, res);
      return true;
    }

    const user = await currentAdmin(req, res);
    if (!user) {
      return true;
    }

    if (path === '/auth/me') {
      sendJson(res, 200, { user: publicUser(user) });
      return true;
    }

    if (path === '/dashboard') {
      dashboard(req, res, user);
      return true;
    }

    if (path === '/conductors' && req.method === 'GET') {
      listConductors(req, res);
      return true;
    }

    if (path === '/conductors' && req.method === 'POST') {
      await createConductor(req, res, user);
      return true;
    }

    const conductorMatch = path.match(/^\/conductors\/(\d+)$/);
    if (conductorMatch) {
      getConductor(req, res, Number(conductorMatch[1]));
      return true;
    }

    const examMatch = path.match(/^\/conductors\/(\d+)\/exams$/);
    if (examMatch) {
      if (req.method !== 'POST') {
        methodNotAllowed(res);
        return true;
      }
      await registerExam(req, res, user, Number(examMatch[1]));
      return true;
    }

    const acaMatch = path.match(/^\/conductors\/(\d+)\/issue-aca$/);
    if (acaMatch) {
      await issueAca(req, res, user, Number(acaMatch[1]));
      return true;
    }

    if (path === '/equipment' && req.method === 'GET') {
      listEquipment(req, res);
      return true;
    }

    if (path === '/equipment' && req.method === 'POST') {
      await createEquipment(req, res, user);
      return true;
    }

    const plateMatch = path.match(/^\/equipment\/(\d+)\/plates$/);
    if (plateMatch) {
      await issuePlate(req, res, user, Number(plateMatch[1]));
      return true;
    }

    const credentialMatch = path.match(/^\/credential\/(aca|pia)\/(\d+)$/);
    if (credentialMatch) {
      getCredential(req, res, credentialMatch[1], Number(credentialMatch[2]));
      return true;
    }

    if (path === '/logs') {
      logs(req, res);
      return true;
    }

    notFound(res);
    return true;
  } catch (error) {
    sendError(res, error.status || 500, error.message || 'Erro interno.');
    return true;
  }
}
