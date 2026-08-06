/**
 * YouCam (Perfect Corp) server-to-server client.
 *
 * Flow, per their docs:
 *   1. POST /s2s/v1.0/client/auth  -> access_token (2h)
 *   2. POST /s2s/v2.0/file/<task>  -> file_id + presigned PUT url
 *   3. PUT the bytes to that url
 *   4. POST /s2s/v2.0/task/<task>  -> task_id
 *   5. GET  /s2s/v2.0/task/<task>/<task_id> until task_status leaves "running"
 *
 * Two things drive the design here:
 *   - Units are only charged on SUCCESSFUL task completion, so failed calls are
 *     free. That makes deliberate probing a legitimate discovery tool.
 *   - "Task will lose if no polling in 10 seconds" per the docs, so the poll loop
 *     stays tight rather than backing off aggressively.
 */

import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { assertUniformResolution } from './concerns.mjs';

// Both hostnames appear in Perfect Corp's docs. We probe for the live one once.
const HOSTS = [
  'https://yce-api-01.perfectcorp.com',
  'https://yce-api-01.makeupar.com',
];

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 180_000;

export class YouCamError extends Error {
  constructor(message, { status, body, url } = {}) {
    super(message);
    this.name = 'YouCamError';
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

/**
 * id_token is the string `client_id=<id>&timestamp=<ms>` RSA-encrypted with the
 * client_secret, which is itself a base64 X.509 (SPKI) *public* key — not a shared
 * secret in the HMAC sense.
 */
function buildIdToken(clientId, clientSecret) {
  const payload = `client_id=${clientId}&timestamp=${Date.now()}`;
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(clientSecret, 'base64'),
    format: 'der',
    type: 'spki',
  });
  const encrypted = crypto.publicEncrypt(
    { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(payload, 'utf8'),
  );
  return encrypted.toString('base64');
}

export class YouCamClient {
  #token = null;
  #tokenExpiresAt = 0;
  #host = null;

  constructor({ apiKey, secretKey, verbose = false } = {}) {
    if (!apiKey || !secretKey) {
      throw new Error('apiKey and secretKey are required');
    }
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.verbose = verbose;
  }

  #log(...args) {
    if (this.verbose) console.error('[youcam]', ...args);
  }

  async #request(url, { method = 'GET', headers = {}, body, raw = false } = {}) {
    const res = await fetch(url, { method, headers, body });
    const text = await res.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    if (raw) return { ok: res.ok, status: res.status, body: parsed };
    if (!res.ok) {
      throw new YouCamError(
        `${method} ${url} -> ${res.status}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`,
        { status: res.status, body: parsed, url },
      );
    }
    return parsed;
  }

  /** Authenticate, trying each documented host until one answers. */
  async authenticate({ force = false } = {}) {
    if (!force && this.#token && Date.now() < this.#tokenExpiresAt) return this.#token;

    const errors = [];
    for (const host of this.#host ? [this.#host] : HOSTS) {
      const url = `${host}/s2s/v1.0/client/auth`;
      const body = JSON.stringify({
        client_id: this.apiKey,
        id_token: buildIdToken(this.apiKey, this.secretKey),
      });
      try {
        const json = await this.#request(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        const token = json?.result?.access_token ?? json?.access_token;
        if (!token) throw new YouCamError(`no access_token in response: ${JSON.stringify(json)}`);
        this.#token = token;
        // Docs say 2h; expire early so a long batch never dies mid-flight.
        this.#tokenExpiresAt = Date.now() + 100 * 60 * 1000;
        this.#host = host;
        this.#log(`authenticated against ${host}`);
        return token;
      } catch (err) {
        errors.push(`${host}: ${err.message}`);
        this.#log(`auth failed on ${host}: ${err.message}`);
      }
    }
    throw new YouCamError(`authentication failed on all hosts:\n  ${errors.join('\n  ')}`);
  }

  get host() {
    return this.#host ?? HOSTS[0];
  }

  async #authHeaders() {
    const token = await this.authenticate();
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }

  /** Upload an image and return its file_id. */
  async uploadFile(taskType, filePath) {
    const bytes = await readFile(filePath);
    const fileName = basename(filePath);
    const contentType = fileName.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

    const init = await this.#request(`${this.host}/s2s/v2.0/file/${taskType}`, {
      method: 'POST',
      headers: await this.#authHeaders(),
      body: JSON.stringify({
        files: [{ content_type: contentType, file_name: fileName, file_size: bytes.length }],
      }),
    });

    const entry = (init?.data?.files ?? init?.result?.files ?? init?.files ?? [])[0];
    if (!entry) throw new YouCamError(`unexpected file init response: ${JSON.stringify(init)}`);

    const fileId = entry.file_id ?? entry.id;
    const req = entry.requests?.[0] ?? entry;
    const putUrl = req.url;
    if (!putUrl) throw new YouCamError(`no upload url in response: ${JSON.stringify(entry)}`);

    // The presigned URL signs content-length and content-type, so these must be
    // echoed back exactly as given. They arrive as a plain object, though the
    // docs show a {key, value} array elsewhere — handle both.
    const putHeaders = {};
    if (Array.isArray(req.headers)) {
      for (const h of req.headers) if (h?.key) putHeaders[h.key] = h.value;
    } else if (req.headers && typeof req.headers === 'object') {
      Object.assign(putHeaders, req.headers);
    }
    putHeaders['Content-Type'] ??= contentType;

    const putRes = await fetch(putUrl, {
      method: req.method ?? 'PUT',
      headers: putHeaders,
      body: bytes,
    });
    if (!putRes.ok) {
      throw new YouCamError(`upload PUT failed: ${putRes.status} ${await putRes.text()}`, {
        status: putRes.status,
      });
    }

    this.#log(`uploaded ${fileName} -> ${fileId}`);
    return fileId;
  }

  /** Create a task. Returns task_id. */
  async createTask(taskType, payload) {
    const json = await this.#request(`${this.host}/s2s/v2.0/task/${taskType}`, {
      method: 'POST',
      headers: await this.#authHeaders(),
      body: JSON.stringify(payload),
    });
    const taskId = json?.result?.task_id ?? json?.data?.task_id ?? json?.task_id;
    if (!taskId) throw new YouCamError(`no task_id in response: ${JSON.stringify(json)}`);
    return taskId;
  }

  /**
   * Fire a task request without caring whether it succeeds. Used for schema
   * discovery: 4xx bodies name the fields the server actually wanted, and
   * failed tasks consume no units.
   */
  async probeTask(taskType, payload) {
    return this.#request(`${this.host}/s2s/v2.0/task/${taskType}`, {
      method: 'POST',
      headers: await this.#authHeaders(),
      body: JSON.stringify(payload),
      raw: true,
    });
  }

  async pollTask(taskType, taskId, { timeoutMs = POLL_TIMEOUT_MS } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const json = await this.#request(`${this.host}/s2s/v2.0/task/${taskType}/${taskId}`, {
        headers: await this.#authHeaders(),
      });
      const data = json?.result ?? json?.data ?? json;
      const status = data?.task_status ?? data?.status;

      if (status === 'success') return data;
      if (status === 'error' || status === 'failed') {
        throw new YouCamError(`task ${taskId} failed: ${JSON.stringify(data)}`, { body: data });
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new YouCamError(`task ${taskId} timed out after ${timeoutMs}ms`);
  }

  /**
   * Upload -> analyse -> poll, in one call.
   *
   * The flat {src_file_id, dst_actions} shape is the one v2.0 accepts; the nested
   * payload/file_sets form documented for v1.0 is rejected here as missing
   * required fields (confirmed by probe).
   */
  async analyzeImage(filePath, actions) {
    assertUniformResolution(actions);
    const fileId = await this.uploadFile('skin-analysis', filePath);
    const taskId = await this.createTask('skin-analysis', {
      src_file_id: fileId,
      dst_actions: actions,
    });
    return this.pollTask('skin-analysis', taskId);
  }
}

export function clientFromEnv({ verbose = false } = {}) {
  return new YouCamClient({
    apiKey: process.env.YOUCAM_API_KEY,
    secretKey: process.env.YOUCAM_SECRET_KEY,
    verbose,
  });
}
