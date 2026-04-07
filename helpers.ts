import { getPortPromise, setBasePort, setHighestPort } from 'portfinder';
import * as os from 'os';
import * as path from 'path';
import { readFileSync } from 'fs';
import * as http from 'http';

export type RuleMap = Record<string, string>;
export type ExcludeMap = Record<string, string[]>;

function looksLikeWildcardPattern(pattern: string): boolean {
    if (!pattern.includes('*')) return false;
    // Preserve explicit regex behavior when the pattern already uses regex syntax.
    return !/[\\^$+?()[\]{}|]/.test(pattern);
}

function escapeRegexLiteral(value: string): string {
    return value.replace(/[|\\{}()[\]^$+?.*]/g, '\\$&');
}

function wildcardPatternToRegex(pattern: string): RegExp {
    const escaped = escapeRegexLiteral(pattern);
    const withOptionalSubdomain = pattern.startsWith('*.')
        ? escaped.replace(/^\\\*\\\./, '(?:[^/:?#]+\\.)*')
        : escaped;
    const regexSource = withOptionalSubdomain.replace(/\\\*/g, '.*');
    return new RegExp(regexSource);
}

export function testRulePattern(pattern: string, input: string): boolean {
    if (looksLikeWildcardPattern(pattern)) {
        return wildcardPatternToRegex(pattern).test(input);
    }
    return new RegExp(pattern).test(input);
}

export function copyHeaders(sourceReq: http.IncomingMessage, targetReq: http.ClientRequest): http.ClientRequest {
    for (const name in sourceReq.headers) {
        if (Object.hasOwnProperty.call(sourceReq.headers, name)) {
            if (name === 'origin') continue;
            const value = sourceReq.headers[name];
            if (value !== undefined) {
                targetReq.setHeader(name, value);
            }
        }
    }
    return targetReq;
}

export function resolveTargetUrl(url: string, ruleMap: RuleMap, excludeMap?: ExcludeMap): string | null {
    const originUrlObj = new URL(url);

    for (const pattern of Object.keys(ruleMap)) {
        if (!testRulePattern(pattern, url)) continue;

        // Check exclusions - if matched, skip this rule and try next
        if (excludeMap?.[pattern]?.some(exc => testRulePattern(exc, url))) {
            continue;
        }

        let urlSegment = ruleMap[pattern];

        // [marker] path rewrite: find marker in original URL, take everything after it as tail
        const bracketMatch = urlSegment.match(/\[([^\]]+)\]/);
        if (bracketMatch) {
            const marker = bracketMatch[1];
            const markerIdx = url.indexOf(marker);
            const before = urlSegment.substring(0, bracketMatch.index!);
            const after = urlSegment.substring(bracketMatch.index! + bracketMatch[0].length);
            if (markerIdx !== -1) {
                const tail = url.substring(markerIdx + marker.length);
                urlSegment = (before + tail + after).replace(/([^:])\/\//g, '$1/');
            } else {
                urlSegment = before + after;
            }
        }

        if (!urlSegment.startsWith('http') && !urlSegment.startsWith('ws') && !urlSegment.startsWith('file')) {
            urlSegment = originUrlObj.protocol + urlSegment;
        }

        if (urlSegment.startsWith('file://')) {
            return urlSegment;
        }

        const targetURLObj = new URL(urlSegment);

        if (!targetURLObj.port && originUrlObj.port) {
            targetURLObj.port = originUrlObj.port;
        }

        if (targetURLObj.pathname === '/' && originUrlObj.pathname !== '/') {
            targetURLObj.pathname = originUrlObj.pathname;
        }

        if (targetURLObj.search === '' && originUrlObj.search) {
            targetURLObj.search = originUrlObj.search;
        }

        const originIsWs = /^wss?:\/\//.test(url);
        const targetIsHttp = /^https?:\/\//.test(targetURLObj.toString());
        if (originIsWs && targetIsHttp) {
            targetURLObj.protocol = originUrlObj.protocol;
        }

        return targetURLObj.toString();
    }

    return null;
}

const parsedBasePort = parseInt(process.env.PORT || '', 10);
const BASE_PORT = Number.isFinite(parsedBasePort) && parsedBasePort > 0 ? parsedBasePort : 8989;

export async function getFreePort(): Promise<number> {
    const highestPort = Math.max(9999, BASE_PORT);
    setBasePort(BASE_PORT);
    setHighestPort(highestPort);
    return getPortPromise();
}

export const ROUTE_RULES_DIR = path.resolve(os.homedir(), '.ep', 'route-rules');

const FILE_PATTERN = /^file:\/\//;
const LOCAL_FILE_PATTERN = /^[A-Za-z]:\\|^\/|^\\/;

export interface ParseEprcResult {
    ruleMap: RuleMap;
    excludeMap: ExcludeMap;
}

export function parseEprcWithExclusions(content: string): ParseEprcResult {
    const ruleMap: RuleMap = Object.create(null);
    const excludeMap: ExcludeMap = Object.create(null);

    content.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return;

        const parts = trimmed.split(/\s+/).filter(Boolean);
        if (parts.length < 2) return;

        // Separate exclusions (tokens starting with !) from regular parts
        const exclusions: string[] = [];
        const regularParts = parts.filter(p => {
            if (p.startsWith('!')) {
                exclusions.push(p.slice(1)); // Remove ! prefix
                return false;
            }
            return true;
        });

        if (regularParts.length < 2) return; // Need at least one rule and one target

        let target = regularParts[regularParts.length - 1];
        const rules = regularParts.slice(0, -1);
        if (LOCAL_FILE_PATTERN.test(target) && !FILE_PATTERN.test(target)) {
            target = 'file://' + (target.replace(/\\/g, '/'));
        }

        rules.forEach(rule => {
            const bm = rule.match(/\[([^\]]+)\]/);
            let patternKey: string;
            if (bm) {
                patternKey = rule.replace(bm[0], bm[1]);
                ruleMap[patternKey] = target + bm[0];
            } else {
                patternKey = rule;
                ruleMap[patternKey] = target;
            }

            // Always set exclusions (even empty array) to override any previous rule
            excludeMap[patternKey] = exclusions.slice(); // Copy the array
        });
    });

    return { ruleMap, excludeMap };
}

export function parseEprc(content: string): RuleMap {
    return parseEprcWithExclusions(content).ruleMap;
}

export function ruleMapToEprcText(ruleMap: RuleMap, excludeMap?: ExcludeMap): string {
    const entries = Object.entries(ruleMap);
    if (entries.length === 0) return '';

    // Group by (target, exclusionsKey) to handle rules with different exclusions
    const byTargetAndExclusions: Record<string, { target: string; rules: string[]; exclusions: string[] }> = {};

    entries.forEach(([rule, target]) => {
        const bm = target.match(/\[([^\]]+)\]/);
        const groupKey = bm ? target.replace(bm[0], '') : target;
        const displayRule = bm ? rule.replace(bm[1], bm[0]) : rule;
        const exclusions = excludeMap?.[rule] || [];
        const exclusionsKey = exclusions.join(',');

        // Create a compound key that includes both target and exclusions
        const compoundKey = `${groupKey}|||${exclusionsKey}`;

        if (!byTargetAndExclusions[compoundKey]) {
            byTargetAndExclusions[compoundKey] = { target: groupKey, rules: [], exclusions };
        }
        byTargetAndExclusions[compoundKey].rules.push(displayRule);
    });

    return Object.values(byTargetAndExclusions)
        .map(({ target, rules, exclusions }) => {
            let displayTarget = target;
            if (FILE_PATTERN.test(target)) {
                displayTarget = target.replace(/^file:\/\//, '').replace(/\//g, path.sep);
            }

            const exclusionStr = exclusions.map(e => `!${e}`).join(' ');
            const rulesStr = rules.join(' ');
            return exclusionStr ? `${rulesStr} ${exclusionStr} ${displayTarget}` : `${rulesStr} ${displayTarget}`;
        })
        .join('\n');
}

export function loadRulesFromTextFile(filePath: string): RuleMap {
    try {
        const content = readFileSync(filePath, 'utf8');
        return parseEprc(content);
    } catch (err: any) {
        console.error('加载规则文件失败:', filePath, err.message);
    }
    return {};
}
