import * as sdk from 'botpress/sdk'

import { HANDOFF_TABLE_NAME, MODULE_NAME } from '../constants'

const ASSIGNMENT_HISTORY_TABLE = 'assignment_history'

const migration: sdk.ModuleMigration = {
  info: {
    description: `Creates ${ASSIGNMENT_HISTORY_TABLE} table to track assignment and reassignment history in ${MODULE_NAME} module`,
    target: 'core',
    type: 'database'
  },
  up: async ({ bp, metadata }: sdk.ModuleMigrationOpts): Promise<sdk.MigrationResult> => {
    const tableName = ASSIGNMENT_HISTORY_TABLE
    const exists = await bp.database.schema.hasTable(tableName)

    if (!exists) {
      await bp.database.createTableIfNotExists(tableName, table => {
        table
          .string('id')
          .primary()
          .notNullable()
        table
          .integer('handoffId')
          .references(`${HANDOFF_TABLE_NAME}.id`)
          .notNullable()
          .onDelete('CASCADE')
        table.string('botId').notNullable()
        table.string('fromAgentId').nullable()
        table.string('toAgentId').notNullable()
        table.string('actionType').notNullable()
        table.dateTime('createdAt').notNullable()

        table.index(['handoffId'])
        table.index(['botId'])
      })
    }

    return {
      success: true,
      message: exists ? 'assignment_history table already exists, skipping...' : 'assignment_history table created.'
    }
  },
  down: async ({ bp }: sdk.ModuleMigrationOpts): Promise<sdk.MigrationResult> => {
    const tableName = ASSIGNMENT_HISTORY_TABLE

    await bp.database.schema.dropTableIfExists(tableName)

    return {
      success: true,
      message: 'assignment_history table dropped.'
    }
  }
}

export default migration
