'use strict';

// Test fixture teardown only. IDs must come from this gate's INSERT results.
async function assertTestDatabase(connection) {
  if (process.env.NODE_ENV !== 'test') throw Error('Notification fixture cleanup requires NODE_ENV=test');
  const [[identity]] = await connection.query('SELECT DATABASE() AS database_name, @@port AS server_port');
  const expectedPort = Number(process.env.DB_PORT || 3306);
  if (identity.database_name !== 'miljor_test_db' ||
      !Number.isInteger(expectedPort) || expectedPort < 1 || expectedPort > 65535 ||
      Number(identity.server_port) !== expectedPort) {
    throw Error('Refusing fixture writes: expected miljor_test_db on MySQL port ' + expectedPort);
  }
  return identity;
}

async function cleanupOwnedNotificationFixtures(db, ownedUserIds) {
  if (!Array.isArray(ownedUserIds) || ownedUserIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw Error('Explicit positive owned test user IDs required');
  }
  const ids = [...new Set(ownedUserIds)];
  const connection = await db.getConnection();
  try {
    await assertTestDatabase(connection);
    if (!ids.length) return;
    await connection.beginTransaction();
    try {
      // Remove links before either referenced outbox. Every predicate is scoped
      // to owned users or to notification/email rows belonging to those users.
      await connection.query(`DELETE d FROM notification_digest_events d
        LEFT JOIN procurement_notifications n ON n.id=d.notice_id
        WHERE d.recipient_id IN (?) OR n.recipient_id IN (?)`, [ids, ids]);
      await connection.query(`DELETE a FROM notification_admin_events a
        LEFT JOIN procurement_notifications n ON n.id=a.notice_id
        LEFT JOIN transactional_email_outbox e ON e.id=a.email_id
        WHERE a.actor_id IN (?) OR n.recipient_id IN (?) OR e.recipient_user_id IN (?)`, [ids, ids, ids]);
      await connection.query('DELETE FROM transactional_email_outbox WHERE recipient_user_id IN (?)', [ids]);
      await connection.query('DELETE FROM platform_notifications WHERE user_id IN (?)', [ids]);
      await connection.query('DELETE FROM procurement_notifications WHERE recipient_id IN (?)', [ids]);
      await connection.query('DELETE FROM notification_preferences WHERE user_id IN (?)', [ids]);
      await connection.query('DELETE FROM notification_email_budgets WHERE user_id IN (?)', [ids]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } finally {
    connection.release();
  }
}

module.exports = {assertTestDatabase, cleanupOwnedNotificationFixtures};
