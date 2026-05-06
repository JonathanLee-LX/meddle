import { 
    ShadowCompareEntry, 
    ShadowCompareStats, 
    ShadowCompareTrackerOptions,
    ShadowDiffItem,
    ShadowSample
} from './types';

interface ShadowCompareState {
    total: number;
    diff: number;
    same: number;
    samples: ShadowSample[];
    diffMap: Map<string, ShadowDiffItem>;
    lastUpdatedAt: number | null;
}

export interface ShadowCompareTracker {
    record(entry: ShadowCompareEntry): boolean;
    getStats(): ShadowCompareStats;
    reset(): void;
}

export function createShadowCompareTracker(
    options: ShadowCompareTrackerOptions = {}
): ShadowCompareTracker {
    const maxSamples = typeof options.maxSamples === 'number' ? options.maxSamples : 20;
    const maxTopDiffs = typeof options.maxTopDiffs === 'number' ? options.maxTopDiffs : 10;
    const state: ShadowCompareState = {
        total: 0,
        diff: 0,
        same: 0,
        samples: [],
        diffMap: new Map(),
        lastUpdatedAt: null,
    };

    return {
        record(entry: ShadowCompareEntry): boolean {
            const baseTarget = entry.baseTarget || '';
            const observedTarget = entry.observedTarget || '';
            const source = entry.source || '';
            const method = entry.method || '';
            const isDiff = baseTarget !== observedTarget;
            
            state.total += 1;
            state.lastUpdatedAt = Date.now();
            
            if (isDiff) {
                state.diff += 1;
                state.samples.push({
                    source,
                    method,
                    baseTarget,
                    observedTarget,
                    ts: Date.now(),
                });
                
                const diffKey = `${baseTarget} => ${observedTarget}`;
                const existing = state.diffMap.get(diffKey) || {
                    baseTarget,
                    observedTarget,
                    count: 0,
                    lastSeenAt: 0,
                    latestSource: '',
                };
                existing.count += 1;
                existing.lastSeenAt = Date.now();
                existing.latestSource = source;
                state.diffMap.set(diffKey, existing);
                
                if (state.samples.length > maxSamples) {
                    state.samples.shift();
                }
            } else {
                state.same += 1;
            }
            return isDiff;
        },
        
        getStats(): ShadowCompareStats {
            const topDiffs = Array.from(state.diffMap.values())
                .sort((a, b) => {
                    if (b.count !== a.count) return b.count - a.count;
                    return b.lastSeenAt - a.lastSeenAt;
                })
                .slice(0, maxTopDiffs);
            
            return {
                total: state.total,
                diff: state.diff,
                same: state.same,
                diffRate: state.total > 0 ? Number((state.diff / state.total).toFixed(4)) : 0,
                uniqueDiffPairs: state.diffMap.size,
                topDiffs,
                samples: state.samples.slice(),
                lastUpdatedAt: state.lastUpdatedAt,
            };
        },
        
        reset(): void {
            state.total = 0;
            state.diff = 0;
            state.same = 0;
            state.samples = [];
            state.diffMap = new Map();
            state.lastUpdatedAt = null;
        },
    };
}
