import { hawkHunter } from '../../../src/hunters/hawk/index.js';
import type { HunterResult } from '../../../src/hunters/base-hunter.js';

export async function runHawk(text: string): Promise<HunterResult> {
  return hawkHunter.scan(text);
}
