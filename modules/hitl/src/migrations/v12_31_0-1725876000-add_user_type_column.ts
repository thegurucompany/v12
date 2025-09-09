import * as sdk from 'botpress/sdk'

const migration: sdk.ModuleMigration = {
  info: {
    description: 'Add user_type column to hitl_sessions',
    type: 'database'
  },
  up: async ({ bp }: sdk.ModuleMigrationOpts): Promise<sdk.MigrationResult> => {
    try {
      const tableName = 'hitl_sessions'
      const column = 'user_type'

      // Check and add user_type column
      const userTypeExists = await bp.database.schema.hasColumn(tableName, column)
      if (!userTypeExists) {
        await bp.database.schema.alterTable(tableName, table => {
          table.string(column).nullable()
        })
      }

      return {
        success: true,
        message: userTypeExists ? 'user_type column already exists, skipping...' : 'user_type column created.'
      }
    } catch (err) {
      return { success: false, message: err.message }
    }
  }
}

export default migration
