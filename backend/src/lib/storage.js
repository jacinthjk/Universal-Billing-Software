// Local-disk object storage. Swap this module for S3/R2/GCS without touching callers.
const fs = require('fs');
const path = require('path');
const config = require('../config');

fs.mkdirSync(config.storageDir, { recursive: true });

function resolveKey(key) {
  const full = path.resolve(config.storageDir, key);
  if (!full.startsWith(config.storageDir)) throw new Error('Invalid storage key');
  return full;
}

async function put(key, buffer) {
  const full = resolveKey(key);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, buffer);
  return key;
}

async function get(key) {
  return fs.promises.readFile(resolveKey(key));
}

const exists = (key) => fs.existsSync(resolveKey(key));
// Only keys under "public/" (logos, product images) are web-served; invoices and reports stay private.
const publicUrl = (key) => `${config.publicApiUrl}/files/${key.split(path.sep).join('/').replace(/^public\//, '')}`;

// Reverse of publicUrl: returns the storage key for one of our own public URLs, else null.
function keyFromPublicUrl(url) {
  const base = `${config.publicApiUrl}/files/`;
  if (!url || !url.startsWith(base)) return null;
  return `public/${url.slice(base.length)}`;
}

// Loads an image we host (logo/product) as a buffer, or null if it isn't ours / is missing.
async function readPublicImage(url) {
  const key = keyFromPublicUrl(url);
  if (!key || !exists(key)) return null;
  return get(key);
}

module.exports = { put, get, exists, publicUrl, resolveKey, keyFromPublicUrl, readPublicImage };
