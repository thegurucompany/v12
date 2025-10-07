import * as sdk from 'botpress/sdk'

const migration: sdk.ModuleMigration = {
  info: {
    description: 'Add message_channel column to hitl_sessions',
    type: 'database'
  },
  up: async ({ bp }: sdk.ModuleMigrationOpts): Promise<sdk.MigrationResult> => {
    try {
      const tableName = 'hitl_sessions'
      const column = 'message_channel'

      // Check and add message_channel column
      const messageChannelExists = await bp.database.schema.hasColumn(tableName, column)
      if (!messageChannelExists) {
        await bp.database.schema.alterTable(tableName, table => {
          table.string(column).nullable()
        })
      }

      return {
        success: true,
        message: messageChannelExists
          ? 'message_channel column already exists, skipping...'
          : 'message_channel column created.'
      }
    } catch (err) {
      return { success: false, message: err.message }
    }
  }
}

export default migration
