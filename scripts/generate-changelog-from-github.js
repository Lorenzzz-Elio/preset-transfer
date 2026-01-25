#!/usr/bin/env node

/**
 * 从 GitHub 对比生成 Changelog
 * 对比本地代码和 GitHub 上的最新 release/tag
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// 获取 GitHub 仓库信息
function getGitHubRepo() {
  try {
    const remote = execSync('git remote get-url origin', {
      cwd: rootDir,
      encoding: 'utf8',
    }).trim();

    // 解析 GitHub URL
    const match = remote.match(/github\.com[:/](.+?)\/(.+?)(\.git)?$/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  } catch (error) {
    console.error('无法获取 GitHub 仓库信息');
  }
  return null;
}

// 获取最新的 release tag
function getLatestReleaseTag() {
  try {
    // 先尝试从 GitHub 获取
    const repo = getGitHubRepo();
    if (repo) {
      console.log(`📡 正在从 GitHub 获取最新 release...`);
      // 这里可以使用 GitHub API，但为了简单起见，我们使用 git tag
    }

    // 从本地 git tags 获取
    const tags = execSync('git tag --sort=-v:refname', {
      cwd: rootDir,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean);

    if (tags.length > 0) {
      return tags[0];
    }

    // 如果没有 tag，使用最近的 commit
    const latestCommit = execSync('git rev-parse HEAD~20', {
      cwd: rootDir,
      encoding: 'utf8',
    }).trim();

    return latestCommit;
  } catch (error) {
    console.error('获取最新 release 失败:', error.message);
    return 'HEAD~20';
  }
}

// 获取详细的文件差异
function getDetailedDiff(fromRef) {
  try {
    const output = execSync(`git diff ${fromRef}..HEAD --stat`, {
      cwd: rootDir,
      encoding: 'utf8',
    }).trim();

    return output;
  } catch (error) {
    return '';
  }
}

// 生成更详细的 changelog
function generateDetailedChangelog(fromRef) {
  const manifest = JSON.parse(readFileSync(join(rootDir, 'manifest.json'), 'utf8'));
  const currentVersion = manifest.version;
  const date = new Date().toISOString().split('T')[0];

  let changelog = `# Changelog\n\n`;
  changelog += `## [${currentVersion}] - ${date}\n\n`;

  // 获取 commit 历史
  const commits = execSync(`git log ${fromRef}..HEAD --pretty=format:"%h|%s|%an|%ad" --date=short`, {
    cwd: rootDir,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean);

  // 分类 commits
  const features = [];
  const fixes = [];
  const improvements = [];
  const ui = [];
  const docs = [];
  const other = [];

  commits.forEach(line => {
    const [hash, message, author, date] = line.split('|');
    const lower = message.toLowerCase();

    const item = `- ${message} ([${hash}](../../commit/${hash}))`;

    if (lower.includes('feat:') || lower.includes('feature') || lower.includes('新增')) {
      features.push(item);
    } else if (lower.includes('fix:') || lower.includes('修复')) {
      fixes.push(item);
    } else if (lower.includes('ui:') || lower.includes('style:') || lower.includes('界面')) {
      ui.push(item);
    } else if (lower.includes('docs:') || lower.includes('文档')) {
      docs.push(item);
    } else if (lower.includes('refactor:') || lower.includes('improve') || lower.includes('优化')) {
      improvements.push(item);
    } else if (!lower.includes('release') && !lower.includes('version')) {
      other.push(item);
    }
  });

  // 生成各个部分
  if (features.length > 0) {
    changelog += `### ✨ 新功能\n\n${features.join('\n')}\n\n`;
  }

  if (fixes.length > 0) {
    changelog += `### 🐛 Bug 修复\n\n${fixes.join('\n')}\n\n`;
  }

  if (improvements.length > 0) {
    changelog += `### 🔧 改进优化\n\n${improvements.join('\n')}\n\n`;
  }

  if (ui.length > 0) {
    changelog += `### 🎨 界面调整\n\n${ui.join('\n')}\n\n`;
  }

  if (docs.length > 0) {
    changelog += `### 📝 文档\n\n${docs.join('\n')}\n\n`;
  }

  if (other.length > 0) {
    changelog += `### 其他变更\n\n${other.join('\n')}\n\n`;
  }

  // 添加文件统计
  const diffStat = getDetailedDiff(fromRef);
  if (diffStat) {
    changelog += `### 📊 文件变更统计\n\n\`\`\`\n${diffStat}\n\`\`\`\n\n`;
  }

  return changelog;
}

// 主函数
function main() {
  console.log('🚀 开始生成 Changelog...\n');

  const latestTag = getLatestReleaseTag();
  console.log(`📌 对比基准: ${latestTag}\n`);

  const changelog = generateDetailedChangelog(latestTag);

  const outputPath = join(rootDir, 'CHANGELOG.md');
  writeFileSync(outputPath, changelog);

  console.log('✅ Changelog 已生成！');
  console.log(`📄 文件位置: ${outputPath}\n`);
  console.log('预览:\n');
  console.log(changelog.split('\n').slice(0, 30).join('\n'));
  console.log('\n...(更多内容请查看文件)');
}

main();
