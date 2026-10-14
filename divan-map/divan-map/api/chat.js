/**
 * Vercel function: POST /api/chat answers a question, GET /api/chat tells the panel whether the assistant is on.
 * The logic is in _proxy.js (files starting with "_" are not published as endpoints).
 * The provider key is read from environment variables set in the Vercel dashboard; see README, "AI assistant".
 */
import { createLimiter, handleChat } from './_proxy.js';

const limiter = createLimiter(); // lives as long as this server instance

export default async function handler(req, res) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const result = await handleChat(
    { method: req.method, headers: req.headers, body: req.body, ip: forwarded || req.socket?.remoteAddress || 'unknown' },
    { env: process.env, fetchImpl: fetch, limiter },
  );
  res.setHeader('Cache-Control', 'no-store');
  res.status(result.status).json(result.json);
}
