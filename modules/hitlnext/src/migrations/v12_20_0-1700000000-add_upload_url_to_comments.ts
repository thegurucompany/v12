import * as sdk from 'botpress/sdk'

import { COMMENT_TABLE_NAME, MODULE_NAME } from '../constants'

const migration: sdk.ModuleMigration = {
  info: {
    description: `Adds uploadUrl column to ${COMMENT_TABLE_NAME} table for file upload support in ${MODULE_NAME} module`,
    target: 'core',
    type: 'database'
  },
  up: async ({ bp, metadata }: sdk.ModuleMigrationOpts): Promise<sdk.MigrationResult> => {
    const tableName = COMMENT_TABLE_NAME
    const column = 'uploadUrl'
    const exists = await bp.database.schema.hasColumn(tableName, column)

    if (!exists) {
      await bp.database.schema.alterTable(tableName, table => table.string(column).nullable())
    }

    return {
      success: true,
      message: exists ? 'uploadUrl column already exists, skipping...' : 'uploadUrl column created.'
    }
  }
}

export default migration
