const DEFAULT_BRANCH = 'main';
const VERSION_CAPTURE_REGEX = '(v?\\d+(?:\\.\\d+){0,3})';

function normalizeVersion(version) {
  if (typeof version !== 'string') return '';
  return version.trim().replace(/^[vV]/, '').trim();
}

function escapeRegExp(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseVersionParts(version) {
  const normalized = normalizeVersion(version);
  const match = normalized.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return [
    parseInt(match[1] ?? '0', 10),
    parseInt(match[2] ?? '0', 10),
    parseInt(match[3] ?? '0', 10),
    parseInt(match[4] ?? '0', 10),
  ];
}

function compareVersions(a, b) {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 4; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function parseGitHubRepo(repoUrl) {
  if (!repoUrl || typeof repoUrl !== 'string') return null;
  try {
    const url = new URL(repoUrl);
    if (url.hostname !== 'github.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
  } catch {
    return null;
  }
}

function encodeGitHubPath(path) {
  const raw = String(path ?? '').replace(/^\/+/, '');
  return raw
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/');
}

function buildRawUrl({ owner, repo, ref, filePath }) {
  const safePath = encodeGitHubPath(filePath);
  return `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${safePath}`;
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }
  return response.json();
}

function buildGitHubHeaders(token) {
  const headers = { Accept: 'application/vnd.github+json' };
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

function base64DecodeUtf8(base64) {
  const raw = String(base64 ?? '').replace(/\s+/g, '');
  const decodedBinary = atob(raw);
  try {
    return decodeURIComponent(escape(decodedBinary));
  } catch {
    return decodedBinary;
  }
}

function buildTagRegexFromTemplate(template) {
  const raw = String(template ?? '').trim();
  if (!raw) return null;

  // If no {version} placeholder is provided, treat the string as a prefix.
  if (!raw.includes('{version}')) {
    return new RegExp(`^${escapeRegExp(raw)}${VERSION_CAPTURE_REGEX}$`, 'i');
  }

  // Treat template as a full tag pattern and extract {version}.
  const parts = raw.split('{version}').map(escapeRegExp);
  const pattern = `^${parts.join(VERSION_CAPTURE_REGEX)}$`;
  return new RegExp(pattern, 'i');
}

function extractVersionFromTag(tagName) {
  const raw = String(tagName ?? '').trim();
  const m = raw.match(/v?\d+(?:\.\d+){0,3}/i);
  if (!m) return null;
  return normalizeVersion(m[0]);
}

function extractVersionFromTagByTemplate(tagName, template) {
  const name = String(tagName ?? '').trim();
  if (!name) return null;

  const regex = buildTagRegexFromTemplate(template);
  if (!regex) return extractVersionFromTag(name);

  const match = name.match(regex);
  if (!match) return null;
  return normalizeVersion(match[1]);
}

function resolveTagNameFromTemplate(template, version) {
  const t = String(template ?? '').trim();
  const v = normalizeVersion(version);
  if (!t) return null;
  if (!v) return null;

  if (t.includes('{version}')) {
    return t.replace(/\{version\}/g, v);
  }

  return `${t}${v}`;
}

async function fetchGitHubTags({ owner, repo, perPage = 100, token = null }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/tags?per_page=${perPage}`;
  const response = await fetch(url, {
    cache: 'no-store',
    headers: buildGitHubHeaders(token),
  });
  if (!response.ok) {
    throw new Error(await readGitHubError(response));
  }
  const tags = await response.json();
  return Array.isArray(tags) ? tags : [];
}

function pickLatestTag(tags, options = {}) {
  const { tagTemplate = '' } = options;
  const items = (Array.isArray(tags) ? tags : [])
    .map(t => {
      const name = t?.name;
      const version = tagTemplate ? extractVersionFromTagByTemplate(name, tagTemplate) : extractVersionFromTag(name);
      return version ? { name, version } : null;
    })
    .filter(Boolean);

  if (items.length === 0) return null;

  return items.reduce((best, cur) => (compareVersions(cur.version, best.version) > 0 ? cur : best), items[0]);
}

function pickLatestTagBefore(tags, options = {}) {
  const { tagTemplate = '', beforeVersion = '' } = options;
  const before = normalizeVersion(beforeVersion);
  if (!before) return null;

  const items = (Array.isArray(tags) ? tags : [])
    .map(t => {
      const name = t?.name;
      const version = tagTemplate ? extractVersionFromTagByTemplate(name, tagTemplate) : extractVersionFromTag(name);
      return version ? { name, version } : null;
    })
    .filter(Boolean)
    .filter(t => compareVersions(t.version, before) < 0);

  if (items.length === 0) return null;

  return items.reduce((best, cur) => (compareVersions(cur.version, best.version) > 0 ? cur : best), items[0]);
}

function resolveRefFromTemplate(template, version) {
  const t = String(template ?? '').trim();
  if (!t) return DEFAULT_BRANCH;
  if (!version) return t;
  return t.replace(/\{version\}/g, normalizeVersion(version));
}

async function fetchGitHubCompare({ owner, repo, base, head, token = null }) {
  if (!base || !head) return null;
  const url = `https://api.github.com/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
  const response = await fetch(url, {
    cache: 'no-store',
    headers: buildGitHubHeaders(token),
  });
  if (!response.ok) {
    throw new Error(await readGitHubError(response));
  }
  return response.json();
}

async function fetchGitHubReleaseByTag({ owner, repo, tagName, token = null }) {
  const tag = String(tagName ?? '').trim();
  if (!tag) {
    throw new Error('未提供 tagName');
  }
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  const response = await fetch(url, {
    cache: 'no-store',
    headers: buildGitHubHeaders(token),
  });
  if (!response.ok) {
    throw new Error(await readGitHubError(response));
  }
  const json = await response.json().catch(() => ({}));
  return json && typeof json === 'object' ? json : {};
}

async function fetchPresetJsonFromGitHubAtRef(source, options = {}) {
  const { ref = '', token = null } = options;
  const repo = parseGitHubRepo(source?.repoUrl);
  if (!repo) {
    throw new Error('无效的 GitHub 仓库地址');
  }

  const filePath = String(source?.filePath ?? '').trim();
  if (!filePath) {
    throw new Error('未配置预设文件路径');
  }

  const r = String(ref ?? '').trim();
  if (!r) {
    throw new Error('未提供 ref');
  }

  const t = String(token ?? '').trim();
  if (t) {
    const safePath = encodeGitHubPath(filePath);
    const apiUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${safePath}?ref=${encodeURIComponent(r)}`;
    const response = await fetch(apiUrl, {
      cache: 'no-store',
      headers: buildGitHubHeaders(t),
    });
    if (!response.ok) {
      throw new Error(await readGitHubError(response));
    }
    const json = await response.json().catch(() => ({}));
    const content = json?.content;
    if (!content) {
      throw new Error('GitHub contents 返回缺少 content 字段');
    }
    const text = base64DecodeUtf8(content);
    const parsed = JSON.parse(text);
    return { url: apiUrl, ref: r, json: parsed };
  }

  const url = buildRawUrl({ ...repo, ref: r, filePath });
  const json = await fetchJson(url);
  return { url, ref: r, json };
}

async function fetchPresetJsonFromGitHub(source, options = {}) {
  const { version = null } = options;
  const repo = parseGitHubRepo(source?.repoUrl);
  if (!repo) {
    throw new Error('无效的 GitHub 仓库地址');
  }

  const filePath = String(source?.filePath ?? '').trim();
  if (!filePath) {
    throw new Error('未配置预设文件路径');
  }

  const ref = resolveRefFromTemplate(source?.refTemplate, version);
  const url = buildRawUrl({ ...repo, ref, filePath });
  const json = await fetchJson(url);
  return { url, ref, json };
}

export {
  DEFAULT_BRANCH,
  normalizeVersion,
  compareVersions,
  parseGitHubRepo,
  fetchGitHubTags,
  pickLatestTag,
  pickLatestTagBefore,
  resolveRefFromTemplate,
  resolveTagNameFromTemplate,
  extractVersionFromTagByTemplate,
  fetchGitHubCompare,
  fetchGitHubReleaseByTag,
  fetchPresetJsonFromGitHubAtRef,
  fetchPresetJsonFromGitHub,
};
