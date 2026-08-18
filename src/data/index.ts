import type { SeriesData, SeriesId } from '../types.js';
import europe from './europe.js';
import america from './america.js';
import asia from './asia.js';

export const SERIES_BY_ID: Record<SeriesId, SeriesData> = { europe, america, asia };

export function listSeries(): SeriesData[] {
  return Object.values(SERIES_BY_ID);
}
