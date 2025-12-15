import { getParentWindow } from '../core/utils.js';

const EXTENSION_NAME = 'preset-transfer';
const DEFAULT_BRANCH = 'main';
const UPDATE_EVENT_NAME = 'preset-transfer:extension-update';

let state = {
  status: 'idle',
  checkedAt: 0,
  local: null,
  remote: null,
  changelog: null,
  error: null,
};

let checkPromise = null;

function getExtensionUpdateState() {
  return state;
}

function dispatchState() {
  try {
    const parentWindow = getParentWindow();
    parentWindow.dispatchEvent(new CustomEvent(UPDATE_EVENT_NAME, { detail: state }));
  } catch {
    // ignore
  }
}

function setState(next) {
  state = { ...state, ...next };
  dispatchState();
}

function normalizeVersion(version) {
  if (typeof version !== 'string') return '';
  return version.trim().replace(/^[vV]/, '').trim();
}

function parseVersionParts(version) {
  const normalized = normalizeVersion(version);
  const match = normalized.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return [
    parseInt(match[1] ?? '0', 10),
    parseInt(match[2] ?? '0', 10),
    parseInt(match[3] ?? '0', 10),
  ];
}

function compareVersions(a, b) {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function parseGitHubRepo(homePage) {
  if (!homePage || typeof homePage !== 'string') return null;
  try {
    const url = new URL(homePage);
    if (url.hostname !== 'github.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
  } catch {
    return null;
  }
}

function getLocalManifestUrl() {
  try {
    return new URL('../manifest.json', import.meta.url).toString();
  } catch {
    return null;
  }
}

function getRemoteRawUrl({ owner, repo, branch, filePath }) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }
  return response.text();
}

function parseChangelogSections(changelogText) {
  const text = String(changelogText || '');
  const lines = text.split(/\r?\n/);
  const sections = [];
  let current = null;

  for (const line of lines) {
    const header = line.match(/^##\s+(.+)\s*$/);
    if (header) {
      if (current) sections.push(current);
      current = { version: normalizeVersion(header[1]), lines: [] };
      continue;
    }
    if (!current) continue;
    current.lines.push(line);
  }

  if (current) sections.push(current);

  return sections.map(s => ({ version: s.version, body: s.lines.join('\n').trim() }));
}

function buildChangelogDelta(changelogText, localVersion, remoteVersion) {
  const sections = parseChangelogSections(changelogText);
  if (!sections.length) {
    return {
      mode: 'raw',
      text: String(changelogText || '').trim(),
    };
  }

  const local = normalizeVersion(localVersion);
  const remote = normalizeVersion(remoteVersion);

  const newerSections = sections.filter(s => {
    if (!s.version) return false;
    return compareVersions(s.version, local) > 0 && (remote ? compareVersions(s.version, remote) <= 0 : true);
  });

  const text = newerSections
    .map(s => `## ${s.version}\n${s.body}`.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();

  if (text) {
    return { mode: 'delta', text };
  }

  return {
    mode: 'latest',
    text: `## ${sections[0].version}\n${sections[0].body}`.trim(),
  };
}

async function loadLocalManifest() {
  const localManifestUrl = getLocalManifestUrl();
  if (!localManifestUrl) throw new Error('无法定位本地 manifest.json');
  const manifest = await fetchJson(localManifestUrl);
  return { url: localManifestUrl, manifest };
}

async function checkForExtensionUpdate() {
  if (checkPromise) return checkPromise;

  checkPromise = (async () => {
    setState({ status: 'checking', error: null });
    try {
      const { manifest: localManifest } = await loadLocalManifest();
      const repo = parseGitHubRepo(localManifest.homePage);

      const local = {
        name: EXTENSION_NAME,
        version: normalizeVersion(localManifest.version),
        homePage: localManifest.homePage || '',
        repo,
      };

      if (!repo) {
        setState({
          status: 'error',
          checkedAt: Date.now(),
          local,
          remote: null,
          changelog: null,
          error: 'homePage 不是 GitHub 仓库地址，无法自动检查更新',
        });
        return state;
      }

      const remoteManifestUrl = getRemoteRawUrl({
        ...repo,
        branch: DEFAULT_BRANCH,
        filePath: 'manifest.json',
      });
      const remoteManifest = await fetchJson(remoteManifestUrl);
      const remote = {
        version: normalizeVersion(remoteManifest.version),
        manifestUrl: remoteManifestUrl,
        branch: DEFAULT_BRANCH,
      };

      const hasUpdate = compareVersions(remote.version, local.version) > 0;
      if (!hasUpdate) {
        setState({
          status: 'up-to-date',
          checkedAt: Date.now(),
          local,
          remote,
          changelog: null,
          error: null,
        });
        return state;
      }

      const remoteChangelogUrl = getRemoteRawUrl({
        ...repo,
        branch: DEFAULT_BRANCH,
        filePath: 'CHANGELOG.md',
      });

      let changelogText = '';
      try {
        changelogText = await fetchText(remoteChangelogUrl);
      } catch {
        changelogText = '';
      }

      const changelog = changelogText
        ? {
            url: remoteChangelogUrl,
            ...buildChangelogDelta(changelogText, local.version, remote.version),
          }
        : null;

      setState({
        status: 'update-available',
        checkedAt: Date.now(),
        local,
        remote,
        changelog,
        error: null,
      });

      return state;
    } catch (error) {
      setState({
        status: 'error',
        checkedAt: Date.now(),
        error: error?.message || String(error),
      });
      return state;
    }
  })();

  return checkPromise;
}

async function updateExtensionViaServer() {
  const parentWindow = getParentWindow();
  const headers =
    typeof parentWindow.getRequestHeaders === 'function'
      ? parentWindow.getRequestHeaders()
      : { 'Content-Type': 'application/json' };

  const response = await fetch('/api/extensions/update', {
    method: 'POST',
    headers,
    body: JSON.stringify({ extensionName: EXTENSION_NAME, global: true }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `更新失败：HTTP ${response.status}`);
  }

  return response.json().catch(() => ({}));
}

export {
  UPDATE_EVENT_NAME,
  checkForExtensionUpdate,
  getExtensionUpdateState,
  loadLocalManifest,
  updateExtensionViaServer,
};

