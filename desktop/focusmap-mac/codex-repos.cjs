function codexRepoListSql() {
  return [
    'SELECT cwd AS absolute_path,',
    "SUM(CASE WHEN archived = 0 AND thread_source = 'user' THEN 1 ELSE 0 END) AS thread_count,",
    'COUNT(*) AS total_thread_count,',
    "MAX(CASE WHEN archived = 0 AND thread_source = 'user' THEN updated_at_ms ELSE NULL END) AS updated_at_ms",
    'FROM threads',
    "WHERE cwd IS NOT NULL AND trim(cwd) <> ''",
    'GROUP BY cwd',
    "HAVING SUM(CASE WHEN archived = 0 AND thread_source = 'user' THEN 1 ELSE 0 END) > 0",
    "ORDER BY MAX(CASE WHEN archived = 0 AND thread_source = 'user' THEN updated_at_ms ELSE 0 END) DESC",
    'LIMIT 80',
  ].join(' ');
}

module.exports = {
  codexRepoListSql,
};
