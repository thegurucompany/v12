import * as sdk from 'botpress/sdk'

const migration: sdk.ModuleMigration = {
  info: {
    description: 'Create user_identification table',
    type: 'database'
  },
  up: async ({ bp }: sdk.ModuleMigrationOpts): Promise<sdk.MigrationResult> => {
    try {
      const tableName = 'user_identification'

      // Check if table already exists
      const tableExists = await bp.database.schema.hasTable(tableName)
      if (!tableExists) {
        await bp.database.schema.createTable(tableName, table => {
          table.increments('id').primary()
          table.string('number').notNullable() // For 10-digit numbers
          table.string('user_type').notNullable()
          table.timestamp('created_at').defaultTo(bp.database.fn.now())
          table.timestamp('updated_at').defaultTo(bp.database.fn.now())
        })

        return {
          success: true,
          message: 'user_identification table created successfully.'
        }
      } else {
        return {
          success: true,
          message: 'user_identification table already exists, skipping...'
        }
      }
    } catch (err) {
      return { success: false, message: err.message }
    }
  }
}

export default migration
