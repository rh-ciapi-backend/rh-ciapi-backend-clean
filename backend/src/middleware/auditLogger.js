function extractIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    null
  );
}

function createAuditLogger(supabase) {
  return async function auditLog(req, payload = {}) {
    try {
      const currentUser = req.currentUser || {};

      await supabase.from('audit_logs').insert({
        actor_user_id: currentUser.id || null,
        actor_email: currentUser.email || null,
        action: payload.action || 'UNKNOWN',
        module: payload.module || 'geral',
        entity_type: payload.entityType || null,
        entity_id: payload.entityId || null,
        entity_label: payload.entityLabel || null,
        description: payload.description || '',
        metadata: payload.metadata || {},
        ip_address: extractIp(req),
      });
    } catch (error) {
      console.error('[auditLog] Falha ao registrar auditoria:', error.message);
    }
  };
}

module.exports = { createAuditLogger };
