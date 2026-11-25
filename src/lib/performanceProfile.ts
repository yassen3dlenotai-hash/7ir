export type PerformanceProfile = 'light' | 'performance';

const STORAGE_KEY = 'mushaf-performance-profile-v1';

export function loadPerformanceProfile(): PerformanceProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'performance') {
      return raw;
    }
  } catch {
    // Ignore storage errors
  }
  return null;
}

export function savePerformanceProfile(profile: PerformanceProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, profile);
  } catch {
    // Ignore storage errors
  }
}
