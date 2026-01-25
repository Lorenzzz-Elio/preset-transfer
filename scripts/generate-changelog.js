#!/usr/bin/env node

/**
 * 自动生成扩展 Changelog
 * 对比 Git 历史，分析代码变更，生成版本更新日志
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// 获取上个版本的 tag
function getLastVersionTag() {
  try {
    const tags = execSync('git tag --sort=-v:refname', { cwd: rootDir, encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
    return tags[0] || 'HEAD~20'; // 如果没有 tag，回退 20 个 commit
  } catch (error) {
    console.warn('无法获取 Git tags，使用最近的 commit');
    return 'HEAD~20';
  }
}

// 获取文件变更统计
function getChangedFiles(fromRef) {
  try {
    const output = execSync(`git diff ${fromRef}..HEAD --name-status`, {
      cwd: rootDir,
      encoding: 'utf8',
    }).trim();

    const changes = { added: [], modified: [], deleted: [] };

    output.split('\n').forEach(line => {
      const [status, file] = line.split('\t');
      if (!file) return;

      // 只关注源代码文件
      if (!file.match(/\.(js|css|json)$/)) return;
      if (file.includes('node_modules') || file.includes('dist/')) return;

      if (status === 'A') changes.added.push(file);
      else if (status === 'M') changes.modified.push(file);
      else if (status === 'D') changes.deleted.push(file);
    });

    return changes;
  } catch (error) {
    console.error('获取文件变更失败:', error.message);
    return { added: [], modified: [], deleted: [] };
  }
}

// 获取 commit 历史
function getCommitHistory(fromRef) {
  try {
    const output = execSync(`git log ${fromRef}..HEAD --pretty=format:"%s"`, {
      cwd: rootDir,
      encoding: 'utf8',
    }).trim();

    return output.split('\n').filter(Boolean);
  } catch (error) {
    console.error('获取 commit 历史失败:', error.message);
    return [];
  }
}

// 分析变更类型
function categorizeChanges(files, commits) {
  const categories = {
    features: [],
    fixes: [],
    improvements: [],
    ui: [],
    performance: [],
    other: [],
  };

  // 从文件路径推断变更类型
  files.added.forEach(file => {
    if (file.includes('features/')) {
      categories.features.push(`新增功能模块: ${file.split('/').pop()}`);
    } else if (file.includes('ui/')) {
      categories.ui.push(`新增 UI 组件: ${file.split('/').pop()}`);
    }
  });

  files.modified.forEach(file => {
    const filename = file.split('/').pop();
    if (file.includes('features/')) {
      categories.features.push(`更新功能: ${filename}`);
    } else if (file.includes('ui/')) {
      categories.ui.push(`更新界面: ${filename}`);
    } else if (file.includes('operations/')) {
      categories.improvements.push(`优化操作逻辑: ${filename}`);
    } else if (file.includes('styles/')) {
      categories.ui.push(`样式调整: ${filename}`);
    }
  });

  // 从 commit message 提取信息
  commits.forEach(msg => {
    const lower = msg.toLowerCase();
    if (lower.includes('feat:') || lower.includes('feature')) {
      categories.features.push(msg.replace(/^feat:\s*/i, ''));
    } else if (lower.includes('fix:')) {
      categories.fixes.push(msg.replace(/^fix:\s*/i, ''));
    } else if (lower.includes('perf:') || lower.includes('performance')) {
      categories.performance.push(msg.replace(/^perf:\s*/i, ''));
    } else if (lower.includes('ui:') || lower.includes('style:')) {
      categories.ui.push(msg.replace(/^(ui|style):\s*/i, ''));
    } else if (lower.includes('refactor:') || lower.includes('improve')) {
      categories.improvements.push(msg.replace(/^refactor:\s*/i, ''));
    } else if (msg.length > 10) {
      categories.other.push(msg);
    }
  });

  return categories;
}

// 生成 Markdown 格式的 changelog
function generateMarkdown(version, categories, stats) {
  const date = new Date().toISOString().split('T')[0];
  let md = `## [${version}] - ${date}\n\n`;

  md += `### 📊 变更统计\n`;
  md += `- 新增文件: ${stats.added} 个\n`;
  md += `- 修改文件: ${stats.modified} 个\n`;
  md += `- 删除文件: ${stats.deleted} 个\n\n`;

  if (categories.features.length > 0) {
    md += `### ✨ 新功能\n`;
    categories.features.forEach(item => md += `- ${item}\n`);
    md += '\n';
  }

  if (categories.fixes.length > 0) {
    md += `### 🐛 Bug 修复\n`;
    categories.fixes.forEach(item => md += `- ${item}\n`);
    md += '\n';
  }

  if (categories.improvements.length > 0) {
    md += `### 🔧 改进优化\n`;
    categories.improvements.forEach(item => md += `- ${item}\n`);
    md += '\n';
  }

  if (categories.ui.length > 0) {
    md += `### 🎨 界面调整\n`;
    categories.ui.forEach(item => md += `- ${item}\n`);
    md += '\n';
  }

  if (categories.performance.length > 0) {
    md += `### ⚡ 性能优化\n`;
    categories.performance.forEach(item => md += `- ${item}\n`);
    md += '\n';
  }

  if (categories.other.length > 0) {
    md += `### 📝 其他变更\n`;
    categories.other.forEach(item => md += `- ${item}\n`);
    md += '\n';
  }

  return md;
}

// 主函数
function main() {
  console.log('🔍 正在分析代码变更...\n');

  // 读取当前版本
  const manifestPath = join(rootDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const currentVersion = manifest.version;

  console.log(`📦 当前版本: ${currentVersion}`);

  // 获取上个版本
  const lastRef = getLastVersionTag();
  console.log(`📌 对比基准: ${lastRef}\n`);

  // 获取变更
  const files = getChangedFiles(lastRef);
  const commits = getCommitHistory(lastRef);

  console.log(`📁 文件变更:`);
  console.log(`   新增: ${files.added.length} 个`);
  console.log(`   修改: ${files.modified.length} 个`);
  console.log(`   删除: ${files.deleted.length} 个`);
  console.log(`📝 Commit 数量: ${commits.length} 个\n`);

  // 分析变更
  const categories = categorizeChanges(files, commits);

  // 生成 changelog
  const stats = {
    added: files.added.length,
    modified: files.modified.length,
    deleted: files.deleted.length,
  };

  const changelog = generateMarkdown(currentVersion, categories, stats);

  // 输出到文件
  const changelogPath = join(rootDir, 'CHANGELOG_DRAFT.md');

  let existingContent = '';
  if (existsSync(changelogPath)) {
    existingContent = readFileSync(changelogPath, 'utf8');
  }

  writeFileSync(changelogPath, changelog + '\n---\n\n' + existingContent);

  console.log('✅ Changelog 草稿已生成！');
  console.log(`📄 文件位置: ${changelogPath}\n`);
  console.log('💡 提示: 这是自动生成的草稿，请根据实际情况编辑后使用。\n');
  console.log('预览:\n');
  console.log(changelog);
}

main();
