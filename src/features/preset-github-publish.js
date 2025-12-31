function encodeGitHubPath(path) {
  const raw = String(path ?? '').replace(/^\/+/, '');
  return raw
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/');
}

function getGitHubHeaders(token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
  const t = String(token ?? '').trim();
  if (t) headers.Authorization = `Bearer ${t}`;
  return headers;
}

async function readGitHubError(response) {
  const text = await response.text().catch(() => '');
  try {
    const json = JSON.parse(text);
    const message = json?.message;
    if (message) return String(message);
  } catch {
    // ignore
  }
  return text || `HTTP ${response.status}`;
}

function base64EncodeUtf8(text) {
  const s = String(text ?? '');
  // btoa expects binary; encode as UTF-8 first.
  return btoa(unescape(encodeURIComponent(s)));
}

async function getGitHubContentInfo({ owner, repo, token, filePath, ref }) {
  const path = encodeGitHubPath(filePath);
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}${query}`;
  const response = await fetch(url, {
    cache: 'no-store',
    headers: getGitHubHeaders(token),
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(await readGitHubError(response));
  }

  const json = await response.json().catch(() => ({}));
  return json && typeof json === 'object' ? json : null;
}

async function upsertGitHubFile({ owner, repo, token, branch, filePath, contentText, message }) {
  const path = encodeGitHubPath(filePath);
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  const existing = await getGitHubContentInfo({ owner, repo, token, filePath, ref: branch });
  const sha = existing?.sha;

  const body = {
    message: String(message ?? '').trim() || `Update ${filePath}`,
    content: base64EncodeUtf8(contentText),
    branch: String(branch ?? '').trim() || undefined,
    sha: sha ? String(sha) : undefined,
  };

  // Remove undefined keys to keep payload clean.
  Object.keys(body).forEach(k => (body[k] === undefined ? delete body[k] : null));

  const response = await fetch(url, {
    method: 'PUT',
    cache: 'no-store',
    headers: getGitHubHeaders(token),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await readGitHubError(response));
  }

  const json = await response.json().catch(() => ({}));
  return json && typeof json === 'object' ? json : {};
}

async function createGitHubTagRef({ owner, repo, token, tagName, sha }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/refs`;
  const body = {
    ref: `refs/tags/${String(tagName ?? '').trim()}`,
    sha: String(sha ?? '').trim(),
  };

  const response = await fetch(url, {
    method: 'POST',
    cache: 'no-store',
    headers: getGitHubHeaders(token),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await readGitHubError(response));
  }

  const json = await response.json().catch(() => ({}));
  return json && typeof json === 'object' ? json : {};
}

async function generateGitHubReleaseNotes({ owner, repo, token, tagName, targetCommitish, previousTagName }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/generate-notes`;
  const body = {
    tag_name: String(tagName ?? '').trim(),
    target_commitish: String(targetCommitish ?? '').trim() || undefined,
    previous_tag_name: String(previousTagName ?? '').trim() || undefined,
  };
  Object.keys(body).forEach(k => (body[k] === undefined ? delete body[k] : null));

  const response = await fetch(url, {
    method: 'POST',
    cache: 'no-store',
    headers: getGitHubHeaders(token),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await readGitHubError(response));
  }

  const json = await response.json().catch(() => ({}));
  return json && typeof json === 'object' ? json : {};
}

async function createGitHubRelease({ owner, repo, token, tagName, name, bodyText, targetCommitish }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases`;
  const body = {
    tag_name: String(tagName ?? '').trim(),
    name: String(name ?? '').trim() || undefined,
    body: String(bodyText ?? '').trim() || undefined,
    target_commitish: String(targetCommitish ?? '').trim() || undefined,
    draft: false,
    prerelease: false,
  };
  Object.keys(body).forEach(k => (body[k] === undefined ? delete body[k] : null));

  const response = await fetch(url, {
    method: 'POST',
    cache: 'no-store',
    headers: getGitHubHeaders(token),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await readGitHubError(response));
  }

  const json = await response.json().catch(() => ({}));
  return json && typeof json === 'object' ? json : {};
}

export {
  upsertGitHubFile,
  createGitHubTagRef,
  generateGitHubReleaseNotes,
  createGitHubRelease,
};

