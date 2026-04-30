import { spiderHunter } from '../../../src/hunters/spider/index.js';
import type { HunterResult } from '../../../src/hunters/base-hunter.js';

export async function runSpider(text: string): Promise<HunterResult> {
  return spiderHunter.scan(text);
}
