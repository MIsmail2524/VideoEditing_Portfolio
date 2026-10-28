'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const v = require('../validate');
const portfolio = require('../portfolio');

module.exports = function publicRoutes({ db }) {
  const router = express.Router();

  const contactLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many messages sent. Please try again later.' },
  });

  router.get('/portfolio', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json(portfolio.publicPayload(db));
  });

  const insertMessage = db.prepare('INSERT INTO messages (name, email, subject, body, created_at) VALUES (?, ?, ?, ?, ?)');
  const countRecent = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE created_at > ?');

  router.post('/contact', contactLimiter, (req, res) => {
    const body = req.body || {};
    // Honeypot: real visitors never fill this hidden field. Pretend success to bots.
    if (body.website) return res.status(201).json({ ok: true });

    const name = v.str(body, 'name', { max: 100, required: true, label: 'Name' });
    const email = v.email(body, 'email', { required: true });
    const subject = v.str(body, 'subject', { max: 150, label: 'Subject' });
    const message = v.str(body, 'message', { max: 5000, min: 10, required: true, multiline: true, label: 'Message' });

    // Global flood guard so a botnet cannot fill the inbox / disk.
    if (countRecent.get(Date.now() - 60 * 60 * 1000).n >= 200) {
      return res.status(429).json({ error: 'The inbox is busy right now. Please email instead.' });
    }
    insertMessage.run(name, email, subject, message, Date.now());
    res.status(201).json({ ok: true });
  });

  return router;
};
