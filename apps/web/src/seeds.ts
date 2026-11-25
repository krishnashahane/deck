import type { Presentation } from '@deck/core';

/** In-memory hand-off of a new document's initial content from the home screen to the editor route. */
export const pendingSeeds = new Map<string, { pres: Presentation; assets: Record<string, Uint8Array> }>();
