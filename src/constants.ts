import * as fs from 'fs';
import * as path from 'path';

const md = fs.readFileSync(path.join(__dirname, '../assets/LanguageSpecification.md'), 'utf8');

function extractKeys(sectionName: string): string[] {
  const start = md.indexOf(`### ${sectionName}`);
  let rest = md.substring(start);
  const end = rest.substring(3).indexOf('###');
  rest = rest.substring(0, end + 3);

  const REGEXP = /\|\s*?`(.+)`\s*?\|/g;
  const keys: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = REGEXP.exec(rest)) !== null) {
    keys.push(match[1]);
  }

  return keys;
}

function extractBlock(sectionName: string): string {
  const start = md.indexOf(`### ${sectionName}`);
  let rest = md.substring(start);
  const end = rest.substring(3).indexOf('###');
  rest = rest.substring(0, end + 3);
  return rest;
}

function extractDocumentation(sectionName: string): string[] {
  const start = md.indexOf(`### ${sectionName}`);
  let rest = md.substring(start);
  const end = rest.substring(3).indexOf('###');
  rest = rest.substring(0, end + 3);

  const REGEXP = /`\s*?(\|.*?\|)\n/g;
  const documentation: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = REGEXP.exec(rest)) !== null) {
    let str: string = match[1].substring(1, match[1].length - 1).trim();
    if (str.indexOf(' | ') !== -1) {
      const arr = str.split('|').map(s => s.trim());
      str = `- **Type**: \`${arr[0]}\`\n- **Description**: ${arr[1]}`;
    }
    documentation.push(str);
  }

  return documentation;
}

export default {
  GYP_SECTION: extractKeys('Top-level Dictionary'),
  GYP_TARGETS_SECTION: extractKeys('targets'),
  GYP_CONFIGURATIONS_SECTION: extractKeys('configurations'),
  GYP_ACTIONS_SECTION: extractKeys('Actions'),
  GYP_RULES_SECTION: extractKeys('Rules'),
  GYP_COPIES_SECTION: extractKeys('Copies'),

  GYP_SECTION_DOCUMENTATION: extractDocumentation('Top-level Dictionary'),
  GYP_TARGETS_SECTION_DOCUMENTATION: extractDocumentation('targets'),
  GYP_CONFIGURATIONS_SECTION_DOCUMENTATION: extractDocumentation('configurations'),
  GYP_ACTIONS_SECTION_DOCUMENTATION: extractDocumentation('Actions'),
  GYP_RULES_SECTION_DOCUMENTATION: extractDocumentation('Rules'),
  GYP_COPIES_SECTION_DOCUMENTATION: extractDocumentation('Copies'),

  links: {
    targets: 'https://github.com/chromium/gyp/blob/md-pages/docs/LanguageSpecification.md#targets',
    target_defaults: 'https://github.com/chromium/gyp/blob/md-pages/docs/LanguageSpecification.md#targets',
    configurations: 'https://github.com/chromium/gyp/blob/md-pages/docs/LanguageSpecification.md#configurations',
    conditions: 'https://github.com/chromium/gyp/blob/md-pages/docs/LanguageSpecification.md#conditionals',
    target_conditions: 'https://github.com/chromium/gyp/blob/md-pages/docs/LanguageSpecification.md#conditionals',
    actions: 'https://github.com/chromium/gyp/blob/md-pages/docs/LanguageSpecification.md#actions',
    rules: 'https://github.com/chromium/gyp/blob/md-pages/docs/LanguageSpecification.md#rules',
    copies: 'https://github.com/chromium/gyp/blob/md-pages/docs/LanguageSpecification.md#copies',
  },

  blocks: {
    targets: extractBlock('targets'),
    target_defaults: extractBlock('targets'),
    configurations: extractBlock('configurations'),
    conditions: extractBlock('Conditionals'),
    target_conditions: extractBlock('Conditionals'),
    actions: extractBlock('Actions'),
    rules: extractBlock('Rules'),
    copies: extractBlock('Copies'),
  },
} as { [key: string]: string[] | { [key: string]: string } };
