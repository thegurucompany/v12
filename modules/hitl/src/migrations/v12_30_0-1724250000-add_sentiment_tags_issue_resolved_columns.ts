import * as sdk from 'botpress/sdk'

const migration: sdk.ModuleMigration = {
  info: {
    description: 'Add sentiment, tags and issue_resolved columns to hitl_sessions',
    type: 'database'
  },
  up: async ({ bp }: sdk.ModuleMigrationOpts): Promise<sdk.MigrationResult> => {
    try {
      const tableName = 'hitl_sessions'

      // Check and add sentiment column
      const sentimentExists = await bp.database.schema.hasColumn(tableName, 'sentiment')
      if (!sentimentExists) {
        await bp.database.schema.alterTable(tableName, table => {
          table.enu('sentiment', ['positivo', 'negativo', 'neutro']).defaultTo('neutro')
        })
      }

      // Check and add tags column
      const tagsExists = await bp.database.schema.hasColumn(tableName, 'tags')
      if (!tagsExists) {
        await bp.database.schema.alterTable(tableName, table => {
          // For PostgreSQL, we'll use JSONB to store the array
          table.jsonb('tags').defaultTo('[]')
        })
      }

      // Check and add issue_resolved column
      const issueResolvedExists = await bp.database.schema.hasColumn(tableName, 'issue_resolved')
      if (!issueResolvedExists) {
        await bp.database.schema.alterTable(tableName, table => {
          table.boolean('issue_resolved').defaultTo(false)
        })
      }

      const messages = []
      if (!sentimentExists) {
        messages.push('sentiment column created')
      }
      if (!tagsExists) {
        messages.push('tags column created')
      }
      if (!issueResolvedExists) {
        messages.push('issue_resolved column created')
      }

      return {
        success: true,
        message: messages.length > 0 ? messages.join(', ') + '.' : 'All columns already exist, skipping...'
      }
    } catch (err) {
      return { success: false, message: err.message }
    }
  }
}

export default migration
