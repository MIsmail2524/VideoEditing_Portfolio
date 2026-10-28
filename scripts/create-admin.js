'use strict';

/**
 * Creates the admin account, or resets the password of an existing one.
 *
 *   npm run create-admin
 *
 * Non-interactive (e.g. first deploy): set ADMIN_USERNAME and ADMIN_PASSWORD. They are only
 * used when no admin exists yet; remove them from the environment after the first start.
 */

const readline = require('node:readline');
const security = require('../src/security');

const USERNAME = /^[A-Za-z0-9._-]{3,32}$/;

async function upsertAdmin(db, username, password) {
  if (!USERNAME.test(username)) throw new Error('Username must be 3-32 characters: letters, numbers, dot, dash or underscore.');
  const problem = security.passwordProblem(password, username);
  if (problem) throw new Error(problem);
  const hash = await security.hashPassword(password);
  const now = Date.now();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ?, failed_attempts = 0, locked_until = 0 WHERE id = ?')
      .run(hash, now, existing.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
    return 'updated';
  }
  db.prepare('INSERT INTO users (username, password_hash, created_at, password_changed_at) VALUES (?, ?, ?, ?)')
    .run(username, hash, now, now);
  return 'created';
}

async function ensureAdminFromEnv(db) {
  const hasUser = db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
  const { ADMIN_USERNAME, ADMIN_PASSWORD } = process.env;
  if (hasUser) {
    if (ADMIN_PASSWORD) console.warn('[warn] ADMIN_PASSWORD is set but an admin already exists. Remove it from the environment.');
    return;
  }
  if (ADMIN_USERNAME && ADMIN_PASSWORD) {
    await upsertAdmin(db, ADMIN_USERNAME, ADMIN_PASSWORD);
    console.log(`Admin "${ADMIN_USERNAME}" created from environment. Remove ADMIN_PASSWORD from your environment now.`);
  } else {
    console.warn('[warn] No admin account yet. Run "npm run create-admin" to create one.');
  }
}

function ask(rl, question, hidden = false) {
  return new Promise((resolve) => {
    if (!hidden) return rl.question(question, (a) => resolve(a.trim()));
    const out = rl.output;
    const write = out.write.bind(out);
    out.write(question);
    rl._writeToOutput = () => {}; // hide typed characters
    rl.question('', (answer) => {
      rl._writeToOutput = (s) => write(s);
      write('\n');
      resolve(answer);
    });
  });
}

async function cli() {
  const { load } = require('../src/config');
  const database = require('../src/db');
  const db = database.open(load());
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    const username = await ask(rl, 'Admin username: ');
    const password = await ask(rl, `Password (min ${security.MIN_PASSWORD_LENGTH} chars, mix of upper/lower/numbers/symbols): `, true);
    const confirm = await ask(rl, 'Repeat password: ', true);
    if (password !== confirm) throw new Error('Passwords do not match.');
    const result = await upsertAdmin(db, username, password);
    console.log(result === 'created' ? `Admin "${username}" created.` : `Password for "${username}" updated. All sessions were signed out.`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  } finally {
    rl.close();
    db.close();
  }
}

if (require.main === module) cli();

module.exports = { upsertAdmin, ensureAdminFromEnv };
