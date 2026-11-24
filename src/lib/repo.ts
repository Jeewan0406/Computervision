// Which GitHub repository this site belongs to (for the 24/7 agents' results
// and the trusted-news index on raw.githubusercontent.com, which allows
// browser access with Access-Control-Allow-Origin: *).
import { useSettings } from './settings';

export const REPO_URL = 'https://github.com/jeewan0406/Computervision';

/** "owner/repo" from a github.io address, or null elsewhere. */
export function detectRepo(): string | null {
  const m = location.hostname.match(/^([a-z0-9-]+)\.github\.io$/i);
  if (!m) return null;
  const seg = location.pathname.split('/').filter(Boolean)[0];
  return seg ? `${m[1]}/${seg}` : `${m[1]}/${m[1]}.github.io`;
}

export function siteRepo(): string {
  return useSettings.getState().agentRepo || detectRepo() || REPO_URL.replace('https://github.com/', '');
}

export const newsIndexUrl = () => `https://raw.githubusercontent.com/${siteRepo()}/news-data/latest.json`;
