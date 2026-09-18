'use strict';
const bcrypt = require('bcryptjs');

// Hash the admin password on first load
let passwordHash = null;
function getPasswordHash() {
  if (!passwordHash) {
    passwordHash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'VillaHola2024!', 10);
  }
  return passwordHash;
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminLoggedIn) return next();
  // API requests get 401
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorised' });
  // Browser requests redirect to login
  return res.redirect('/admin/login');
}

async function loginAdmin(username, password) {
  const validUser = username === (process.env.ADMIN_USERNAME || 'admin');
  const validPass = await bcrypt.compare(password, getPasswordHash());
  return validUser && validPass;
}

module.exports = { requireAdmin, loginAdmin };
