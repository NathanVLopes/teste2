import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { makePassword, sessionHash, secureToken } from './security.js';

export const db = new DatabaseSync(config.dbFile);

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('ADMIN', 'GESTOR', 'ATENDENTE', 'AGENTE')),
    module TEXT NOT NULL CHECK (module IN ('admin', 'fiscal')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    module TEXT NOT NULL CHECK (module IN ('admin', 'fiscal')),
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS conductors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    birth_date TEXT NOT NULL,
    cpf_encrypted TEXT NOT NULL,
    cpf_hash TEXT NOT NULL UNIQUE,
    mother_name TEXT NOT NULL,
    father_name TEXT,
    photo_data_url TEXT,
    residence_address TEXT NOT NULL,
    residence_proof_date TEXT NOT NULL,
    id_document_type TEXT NOT NULL,
    id_document_number_encrypted TEXT NOT NULL,
    id_document_file_name TEXT,
    has_cnh INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'CADASTRADO',
    aca_number TEXT UNIQUE,
    aca_issue_date TEXT,
    aca_valid_until TEXT,
    aca_token_id INTEGER REFERENCES qr_tokens(id),
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS legal_guardians (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conductor_id INTEGER NOT NULL UNIQUE REFERENCES conductors(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    cpf_encrypted TEXT NOT NULL,
    cpf_hash TEXT NOT NULL,
    relationship TEXT NOT NULL,
    phone TEXT,
    document_number_encrypted TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS equipment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    remia_number TEXT NOT NULL UNIQUE,
    owner_name TEXT NOT NULL,
    owner_cpf_cnpj_encrypted TEXT NOT NULL,
    owner_cpf_cnpj_hash TEXT NOT NULL,
    owner_document_encrypted TEXT NOT NULL,
    owner_residence_address TEXT NOT NULL,
    owner_residence_proof_date TEXT NOT NULL,
    conductor_id INTEGER NOT NULL REFERENCES conductors(id),
    manufacturer TEXT NOT NULL,
    model TEXT NOT NULL,
    color TEXT NOT NULL,
    serial_number TEXT NOT NULL,
    provenance_type TEXT NOT NULL CHECK (provenance_type IN ('NOTA_FISCAL', 'DECLARACAO')),
    provenance_document TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'REGISTRADO',
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS plates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_id INTEGER NOT NULL REFERENCES equipment(id),
    code TEXT NOT NULL UNIQUE,
    municipality TEXT NOT NULL,
    emission_sequence INTEGER NOT NULL,
    first_emission_free INTEGER NOT NULL,
    fee_due INTEGER NOT NULL DEFAULT 0,
    issue_date TEXT NOT NULL,
    qr_token_id INTEGER REFERENCES qr_tokens(id),
    status TEXT NOT NULL DEFAULT 'ATIVA',
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    file_name TEXT,
    issued_at TEXT,
    status TEXT NOT NULL DEFAULT 'VALIDO',
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS exams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conductor_id INTEGER REFERENCES conductors(id) ON DELETE CASCADE,
    scheduled_date TEXT NOT NULL,
    result TEXT NOT NULL DEFAULT 'AGENDADA' CHECK (result IN ('AGENDADA', 'APROVADA', 'REPROVADA')),
    score REAL,
    notes TEXT,
    registered_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS qr_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    token_encrypted TEXT NOT NULL,
    token_prefix TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('ACA', 'PIA')),
    conductor_id INTEGER REFERENCES conductors(id),
    equipment_id INTEGER REFERENCES equipment(id),
    plate_id INTEGER REFERENCES plates(id),
    active INTEGER NOT NULL DEFAULT 1,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS access_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    ip TEXT,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions(token_hash);
  CREATE INDEX IF NOT EXISTS idx_conductors_name ON conductors(name);
  CREATE INDEX IF NOT EXISTS idx_equipment_remia ON equipment(remia_number);
  CREATE INDEX IF NOT EXISTS idx_plates_code ON plates(code);
  CREATE INDEX IF NOT EXISTS idx_tokens_hash ON qr_tokens(token_hash);
  CREATE INDEX IF NOT EXISTS idx_exams_month ON exams(scheduled_date);
  CREATE INDEX IF NOT EXISTS idx_logs_created ON access_logs(created_at);
`);

export function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}

export function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

export function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

export function insertDemoUser({ name, username, password, role, module }) {
  const existing = get('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) {
    return;
  }

  run(
    'INSERT INTO users (name, username, password_hash, role, module) VALUES (?, ?, ?, ?, ?)',
    [name, username, makePassword(password), role, module]
  );
}

insertDemoUser({
  name: 'Administrador NAVETRAN',
  username: 'admin',
  password: 'Navetran@2026',
  role: 'ADMIN',
  module: 'admin'
});

insertDemoUser({
  name: 'Atendimento ACA',
  username: 'atendimento',
  password: 'Atende@2026',
  role: 'ATENDENTE',
  module: 'admin'
});

insertDemoUser({
  name: 'Agente de Transito',
  username: 'agente',
  password: 'Fiscal@2026',
  role: 'AGENTE',
  module: 'fiscal'
});

export function createSession(userId, module) {
  const token = secureToken(36);
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 10).toISOString();
  run('INSERT INTO sessions (user_id, module, token_hash, expires_at) VALUES (?, ?, ?, ?)', [
    userId,
    module,
    sessionHash(token),
    expires
  ]);
  return { token, expires };
}

export function findSession(rawToken, module) {
  if (!rawToken) {
    return null;
  }

  run('DELETE FROM sessions WHERE expires_at < ?', [new Date().toISOString()]);

  return get(
    `SELECT
      sessions.id AS session_id,
      users.id,
      users.name,
      users.username,
      users.role,
      users.module
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
      AND sessions.module = ?
      AND sessions.expires_at >= ?
      AND users.active = 1`,
    [sessionHash(rawToken), module, new Date().toISOString()]
  );
}

export function destroySession(rawToken, module) {
  if (!rawToken) {
    return;
  }
  run('DELETE FROM sessions WHERE token_hash = ? AND module = ?', [sessionHash(rawToken), module]);
}

export function logAccess(module, userId, action, ip, details = {}) {
  run('INSERT INTO access_logs (module, user_id, action, ip, details) VALUES (?, ?, ?, ?, ?)', [
    module,
    userId || null,
    action,
    ip || '',
    JSON.stringify(details)
  ]);
}

export function publicUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    module: user.module
  };
}
