/**
 * Every collection in the app. Imported by both the worker and the browser.
 * The server bakes these in at deploy time, so a change needs a redeploy.
 */

import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { playtestSchemas } from './schemas/playtest-schemas'

export const schemas: CollectionSchema[] = [usersSchema, ...playtestSchemas]
